"""Stop Chatterbox-Turbo from talking past the script.

The turbo sampler often never emits its stop token. It then repeats the last
stretch of speech until it hits a 40 second cap. This replaces that sampler
for one call: the stop token keeps the score the model actually gave it, and
a repeated stretch of tokens is dropped before audio is built.
"""

from __future__ import annotations

_GRAM = 16
_STUCK_RUN = 12

print("[tts] End-of-script guard is on.", flush=True)


def _loop_cut(token_ids: list[int], gram: int = _GRAM) -> int | None:
    """Index where a second copy of an earlier span begins."""
    n = len(token_ids)
    if gram < 8 or n < gram * 2:
        return None
    tail = token_ids[-gram:]
    last = n - gram
    i = last - gram
    while i >= 0:
        if token_ids[i : i + gram] == tail:
            period = last - i
            if (
                period >= gram
                and n >= period * 2
                and token_ids[n - period : n] == token_ids[n - (2 * period) : n - period]
            ):
                return n - period
        i -= 1
    return None


def _stuck_cut(token_ids: list[int], run: int = _STUCK_RUN) -> int | None:
    if len(token_ids) < run:
        return None
    if len(set(token_ids[-run:])) == 1:
        return len(token_ids) - run + 2
    return None


def _trim_point(token_ids: list[int]) -> int | None:
    stuck = _stuck_cut(token_ids)
    loop = _loop_cut(token_ids)
    cuts = [cut for cut in (stuck, loop) if cut is not None]
    if not cuts:
        return None
    return min(cuts)


def release_speech_cache() -> None:
    """Drop leftover speech-step memory. The loaded voice model stays put."""
    import gc

    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        return


def _forget_cache(past_key_values) -> None:
    """Best-effort shrink of a Hugging Face cache object before its refs die."""
    if past_key_values is None:
        return
    for name in ("crop", "reset"):
        method = getattr(past_key_values, name, None)
        if not callable(method):
            continue
        try:
            method(0) if name == "crop" else method()
        except Exception:
            continue


def bounded_inference_turbo(
    t3,
    t3_cond,
    text_tokens,
    temperature=0.8,
    top_k=1000,
    top_p=0.95,
    repetition_penalty=1.2,
    max_gen_len=1000,
):
    import torch

    # The stock sampler is inference-only. This replacement used to run with
    # autograd on, so each clip kept the growing speech cache in host RAM.
    with torch.inference_mode():
        tokens = _sample_spoken(
            t3,
            t3_cond,
            text_tokens,
            temperature=temperature,
            top_k=top_k,
            top_p=top_p,
            repetition_penalty=repetition_penalty,
            max_gen_len=max_gen_len,
        )
    release_speech_cache()
    return tokens


def _sample_spoken(
    t3,
    t3_cond,
    text_tokens,
    temperature=0.8,
    top_k=1000,
    top_p=0.95,
    repetition_penalty=1.2,
    max_gen_len=1000,
):
    import torch
    import torch.nn.functional as F
    from transformers.generation.logits_process import (
        LogitsProcessorList,
        RepetitionPenaltyLogitsProcessor,
        TemperatureLogitsWarper,
        TopKLogitsWarper,
        TopPLogitsWarper,
    )

    logits_processors = LogitsProcessorList()
    if temperature > 0 and temperature != 1.0:
        logits_processors.append(TemperatureLogitsWarper(temperature))
    if top_k > 0:
        logits_processors.append(TopKLogitsWarper(top_k))
    if top_p < 1.0:
        logits_processors.append(TopPLogitsWarper(top_p))
    if repetition_penalty != 1.0:
        logits_processors.append(RepetitionPenaltyLogitsProcessor(repetition_penalty))

    stop_id = int(t3.hp.stop_speech_token)
    speech_start_token = t3.hp.start_speech_token * torch.ones_like(text_tokens[:, :1])
    embeds, _ = t3.prepare_input_embeds(
        t3_cond=t3_cond,
        text_tokens=text_tokens,
        speech_tokens=speech_start_token,
        cfg_weight=0.0,
    )

    generated: list = []
    ids: list[int] = []

    def take(input_ids, speech_logits):
        raw = speech_logits[:, -1, :]
        processed = logits_processors(input_ids, raw.clone())
        if 0 <= stop_id < processed.shape[-1]:
            processed[:, stop_id] = raw[:, stop_id]
        if torch.all(processed == -float("inf")):
            return None
        probs = F.softmax(processed, dim=-1)
        return torch.multinomial(probs, num_samples=1)

    def push(token) -> bool:
        """Append one speech token. Return False when generation should stop."""
        if token is None:
            return False
        generated.append(token)
        ids.append(int(token.view(-1)[0].item()))
        if ids[-1] == stop_id:
            return False
        cut = _trim_point(ids)
        if cut is None:
            return True
        dropped = len(ids) - cut
        del generated[cut:]
        del ids[cut:]
        print(
            f"[tts] Cut a repeated ending ({dropped} speech tokens dropped, {len(ids)} kept).",
            flush=True,
        )
        return False

    past_key_values = None
    llm_outputs = None
    hidden_states = None
    step = None
    try:
        llm_outputs = t3.tfmr(inputs_embeds=embeds, use_cache=True)
        hidden_states = llm_outputs[0]
        past_key_values = llm_outputs.past_key_values
        first = take(speech_start_token, t3.speech_head(hidden_states[:, -1:]))
        if not push(first):
            return _finish(t3, generated, stop_id)

        current = generated[-1]
        for _ in range(max_gen_len):
            step = t3.tfmr(
                inputs_embeds=t3.speech_emb(current),
                past_key_values=past_key_values,
                use_cache=True,
            )
            hidden_states = step[0]
            past_key_values = step.past_key_values
            nxt = take(torch.cat(generated, dim=1), t3.speech_head(hidden_states))
            if not push(nxt):
                break
            current = generated[-1]

        return _finish(t3, generated, stop_id)
    finally:
        _forget_cache(past_key_values)
        past_key_values = None
        llm_outputs = None
        hidden_states = None
        step = None
        embeds = None
        generated.clear()


def _finish(t3, generated: list, stop_id: int):
    import torch

    if not generated:
        return torch.zeros(1, 0, dtype=torch.long, device=t3.device)
    tokens = torch.cat(generated, dim=1)
    if tokens.size(1) > 0 and int(tokens[0, -1].item()) == stop_id:
        tokens = tokens[:, :-1]
    return tokens


def generate_spoken(model, text: str):
    """One turbo reading that does not keep the last sentence going."""
    t3 = model.t3
    original = t3.inference_turbo

    def inference_turbo(
        t3_cond,
        text_tokens,
        temperature=0.8,
        top_k=1000,
        top_p=0.95,
        repetition_penalty=1.2,
        max_gen_len=1000,
    ):
        return bounded_inference_turbo(
            t3,
            t3_cond,
            text_tokens,
            temperature=temperature,
            top_k=top_k,
            top_p=top_p,
            repetition_penalty=repetition_penalty,
            max_gen_len=max_gen_len,
        )

    t3.inference_turbo = inference_turbo
    try:
        return model.generate(text=text)
    finally:
        t3.inference_turbo = original


if __name__ == "__main__":
    intro = list(range(100, 180))
    sentence = list(range(40))
    full = intro + sentence + sentence
    assert _loop_cut(full) == len(intro) + len(sentence)
    partial = intro + sentence + sentence[:10]
    assert _loop_cut(partial) is None
    assert _stuck_cut([3] * 12) == 2
    assert _stuck_cut([1, 2, 3, 4]) is None
    print("turbo stop checks ok")
