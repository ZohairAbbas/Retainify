import Icons from "../ui/Icons.jsx";

export default function EmptyTab({ icon, title, body }) {
  const Icon = Icons[icon] || Icons.Bolt;
  return (
    <div className="rt-tab-empty">
      <div className="rt-tab-empty-icon">
        <Icon size={20} />
      </div>
      <div className="rt-tab-empty-title">{title}</div>
      <div className="rt-tab-empty-body muted">{body}</div>
    </div>
  );
}
