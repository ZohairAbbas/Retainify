import { editorialTemplate } from "./editorial.jsx";
import { brutalistTemplate } from "./brutalist.jsx";
import { wheelTemplate } from "./wheel.jsx";
import { stickerTemplate } from "./sticker.jsx";
import { holidayTemplate } from "./holiday.jsx";
import { customTemplate } from "./custom.jsx";
import { KIT_TEMPLATES } from "./kit-templates.jsx";

export const TEMPLATES = {
  editorial: editorialTemplate,
  brutalist: brutalistTemplate,
  wheel: wheelTemplate,
  sticker: stickerTemplate,
  holiday: holidayTemplate,
  custom: customTemplate,
  ...Object.fromEntries(KIT_TEMPLATES.map((t) => [t.id, t])),
};

// Highest-converting layouts first, then the stylistic ones; custom HTML last.
export const TEMPLATE_ORDER = [
  "spotlight", "twostep", "slidein", "countdown", "newsletter", "bar",
  "editorial", "brutalist", "wheel", "sticker", "holiday", "custom",
];

export function getTemplate(id) {
  return TEMPLATES[id] || TEMPLATES.editorial;
}

export function getDefaults(id) {
  return { ...getTemplate(id).defaults };
}

// Fields that carry across template switches when possible.
const PORTABLE_KEYS = ["headline", "body", "cta", "placeholder", "fine", "discount", "offerCode", "trigger", "delay", "frequency", "whatsappOptIn"];

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
