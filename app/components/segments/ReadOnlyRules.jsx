import { formatRuleValue } from "./constants.js";

export default function ReadOnlyRules({ tree, fields, tags = [] }) {
  if (!tree) return null;
  const fieldsById = Object.fromEntries(fields.map((f) => [f.id, f]));
  const tagsById = Object.fromEntries(tags.map((t) => [t.id, t]));
  return <Group node={tree} fieldsById={fieldsById} tagsById={tagsById} />;
}

function Group({ node, fieldsById, tagsById }) {
  if (!node || node.type !== "group") return null;
  const isAny = node.match === "any";
  return (
    <div className="rt-rd-grp">
      <div className={`rt-rd-grp-head ${isAny ? "rt-any" : ""}`}>
        Match {isAny ? "any" : "all"} of:
      </div>
      <div className="rt-rd-grp-body">
        {node.children?.map((c, i) => (
          <div key={i}>
            {c.type === "group" ? (
              <Group node={c} fieldsById={fieldsById} tagsById={tagsById} />
            ) : (
              <Rule rule={c} fieldsById={fieldsById} tagsById={tagsById} />
            )}
          </div>
        ))}
        {(!node.children || node.children.length === 0) && (
          <div className="rt-rd-rule" style={{ color: "var(--ink-3)" }}>
            (No rules)
          </div>
        )}
      </div>
    </div>
  );
}

function Rule({ rule, fieldsById, tagsById }) {
  const f = fieldsById[rule.field];
  if (!f) return null;
  const opLabel = (() => {
    switch (rule.op) {
      case "gt": return "is more than";
      case "lt": return "is less than";
      case "eq": return "is exactly";
      case "between": return "is between";
      case "in_last": return "in the last";
      case "more_than": return "more than";
      case "before": return "is before";
      case "after": return "is after";
      case "empty": return "is empty";
      case "is": return "is";
      case "is_not": return "is not";
      case "is_one_of": return "is one of";
      case "is_true": return "is true";
      case "is_false": return "is false";
      case "has": return "is";
      case "has_not": return "is not";
      case "has_any": return "is any of";
      default: return rule.op;
    }
  })();
  return (
    <div className="rt-rd-rule">
      <span className="rt-rd-rule-field">{f.label}</span>
      <span className="rt-rd-rule-op">{opLabel}</span>
      {rule.op !== "empty" && rule.op !== "is_true" && rule.op !== "is_false" && (
        <span className="rt-rd-rule-val">{formatRuleValue(rule, fieldsById, tagsById)}</span>
      )}
    </div>
  );
}
