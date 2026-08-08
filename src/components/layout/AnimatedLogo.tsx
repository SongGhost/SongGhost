import Link from "next/link";
import styles from "./AnimatedLogo.module.css";

export default function AnimatedLogo() {
  return (
    <Link
      className="flex items-center no-underline"
      href="/"
      aria-label="SongHost home"
    >
      <div className={styles.logoContainer}>
        <div className={styles.auraGlow} />
        <div className={styles.logoText}>
          <span className={`${styles.char} ${styles.cS} text-white`}>S</span>
          <span className={`${styles.char} ${styles.cO} text-white`}>o</span>
          <span className={`${styles.char} ${styles.cN} text-white`}>n</span>
          {/* Slot for g -> G (accent moves onto g / G in the morphed state) */}
          <span className={styles.charSlot}>
            <span
              className={`${styles.char} ${styles.gLower} text-white transition-colors duration-300 ease-in-out`}
            >
              g
            </span>
            <span
              className={`${styles.char} ${styles.gUpper} text-accent transition-colors duration-300 ease-in-out`}
            >
              G
            </span>
          </span>
          {/* Slot for H -> h (accent starts on H, then clears to white as h) */}
          <span className={styles.charSlot}>
            <span
              className={`${styles.char} ${styles.hUpper} text-accent transition-colors duration-300 ease-in-out`}
            >
              H
            </span>
            <span
              className={`${styles.char} ${styles.hLower} text-white transition-colors duration-300 ease-in-out`}
            >
              h
            </span>
          </span>
          <span className={`${styles.char} ${styles.cO2} text-white`}>o</span>
          <span className={`${styles.char} ${styles.cS2} text-white`}>s</span>
          <span className={`${styles.char} ${styles.cT} text-white`}>t</span>
        </div>
      </div>
    </Link>
  );
}
