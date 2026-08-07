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
          <span className={`${styles.char} ${styles.cS}`}>S</span>
          <span className={`${styles.char} ${styles.cO}`}>o</span>
          <span className={`${styles.char} ${styles.cN}`}>n</span>
          {/* Slot for g -> G */}
          <span className={styles.charSlot}>
            <span className={`${styles.char} ${styles.gLower}`}>g</span>
            <span className={`${styles.char} ${styles.gUpper}`}>G</span>
          </span>
          {/* Slot for H -> h */}
          <span className={styles.charSlot}>
            <span className={`${styles.char} ${styles.hUpper}`}>H</span>
            <span className={`${styles.char} ${styles.hLower}`}>h</span>
          </span>
          <span className={`${styles.char} ${styles.cO2}`}>o</span>
          <span className={`${styles.char} ${styles.cS2}`}>s</span>
          <span className={`${styles.char} ${styles.cT}`}>t</span>
        </div>
        <span className={styles.subTag}>
          <span style={{ color: "#525866" }}>STUDIO</span>{" "}
          <span style={{ color: "#f5a623" }}>RADIO</span>
        </span>
      </div>
    </Link>
  );
}
