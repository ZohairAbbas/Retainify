import { useState } from "react";
import { useFetcher } from "react-router";
import Icons from "../ui/Icons.jsx";
import TagChip from "./TagChip.jsx";

export default function TagsCard({ contactId, contactTags, allTags }) {
  const fetcher = useFetcher();
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");

  const appliedIds = new Set(contactTags.map((t) => t.id));
  const filtered = allTags.filter(
    (t) =>
      !appliedIds.has(t.id) &&
      (!value || t.name.toLowerCase().includes(value.toLowerCase())),
  );
  const exactMatch = allTags.find((t) => t.name.toLowerCase() === value.trim().toLowerCase());
  const canCreate = value.trim() && !exactMatch;

  const apply = (tagId) => {
    const fd = new FormData();
    fd.set("intent", "apply_tag");
    fd.set("contactId", contactId);
    fd.set("tagId", tagId);
    fetcher.submit(fd, { method: "post" });
  };

  const create = () => {
    const fd = new FormData();
    fd.set("intent", "create_and_apply_tag");
    fd.set("contactId", contactId);
    fd.set("name", value.trim());
    fetcher.submit(fd, { method: "post" });
    setValue("");
    setAdding(false);
  };

  const remove = (tagId) => {
    const fd = new FormData();
    fd.set("intent", "remove_tag");
    fd.set("contactId", contactId);
    fd.set("tagId", tagId);
    fetcher.submit(fd, { method: "post" });
  };

  return (
    <div className="rt-rail-card">
      <div className="rt-rail-head">
        <span className="t-micro">Tags</span>
        <span className="rt-rail-count">{contactTags.length}</span>
      </div>
      <div className="rt-rail-tags">
        {contactTags.map((t) => (
          <TagChip
            key={t.id}
            tag={t}
            removable
            onRemove={() => remove(t.id)}
          />
        ))}
        {contactTags.length === 0 && (
          <span className="muted t-small">No tags yet.</span>
        )}
      </div>
      {!adding ? (
        <button
          type="button"
          className="rt-rail-add"
          onClick={() => setAdding(true)}
        >
          <Icons.Plus size={12} /> Add tag
        </button>
      ) : (
        <div className="rt-rail-addbox">
          <input
            className="input"
            autoFocus
            placeholder="Type a tag…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canCreate) {
                e.preventDefault();
                create();
              }
            }}
            onBlur={() => setTimeout(() => setAdding(false), 200)}
          />
          {(filtered.length > 0 || canCreate) && (
            <div className="rt-rail-tagmenu">
              {filtered.slice(0, 6).map((t) => (
                <button
                  type="button"
                  key={t.id}
                  className="rt-rail-tagitem"
                  onMouseDown={() => {
                    apply(t.id);
                    setValue("");
                    setAdding(false);
                  }}
                >
                  <TagChip tag={t} />
                </button>
              ))}
              {canCreate && (
                <button
                  type="button"
                  className="rt-rail-tagitem"
                  onMouseDown={create}
                >
                  <span className="t-small">Create “{value.trim()}”</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
