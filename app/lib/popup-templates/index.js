import { editorialTemplate } from "./editorial.jsx";
import { brutalistTemplate } from "./brutalist.jsx";
import { wheelTemplate } from "./wheel.jsx";
import { stickerTemplate } from "./sticker.jsx";
import { holidayTemplate } from "./holiday.jsx";

export const TEMPLATES = {
  editorial: editorialTemplate,
  brutalist: brutalistTemplate,
  wheel: wheelTemplate,
  sticker: stickerTemplate,
  holiday: holidayTemplate,
};

export const TEMPLATE_ORDER = ["editorial", "brutalist", "wheel", "sticker", "holiday"];

export function getTemplate(id) {
  return TEMPLATES[id] || TEMPLATES.editorial;
}

export function getDefaults(id) {
  return { ...getTemplate(id).defaults };
}

// Fields that carry across template switches when possible.
const PORTABLE_KEYS = ["headline", "body", "cta", "placeholder", "fine", "discount", "trigger", "delay", "frequency"];

export function mergeOnTemplateSwitch(currentConfig, newTemplateId) {
  const defaults = getDefaults(newTemplateId);
  const portable = {};
  for (const key of PORTABLE_KEYS) {
    if (currentConfig && currentConfig[key] !== undefined && currentConfig[key] !== "") {
      portable[key] = currentConfig[key];
    }
  }
  return { ...defaults, ...portable, template: newTemplateId };
}
