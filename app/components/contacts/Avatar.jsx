import { avatarColors, initials } from "./constants.js";

export default function Avatar({ name, email, size = 28 }) {
  const seed = (name || email || "").toLowerCase();
  const { bg, ink } = avatarColors(seed);
  return (
    <div
      className="rt-avatar"
      style={{
        width: size,
        height: size,
        background: bg,
        color: ink,
        fontSize: Math.round(size * 0.42),
      }}
    >
      {initials(name || email)}
    </div>
  );
}
