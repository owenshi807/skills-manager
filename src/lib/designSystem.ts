export const DESIGN_SKINS = ["skill-manager"] as const;

export type DesignSkin = (typeof DESIGN_SKINS)[number];

export const DEFAULT_DESIGN_SKIN: DesignSkin = "skill-manager";

const STORAGE_KEY = "design-skin";

function isDesignSkin(value: string | null): value is DesignSkin {
  return value !== null && DESIGN_SKINS.includes(value as DesignSkin);
}

export function getDesignSkin(): DesignSkin {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isDesignSkin(stored) ? stored : DEFAULT_DESIGN_SKIN;
}

export function applyDesignSkin(skin: DesignSkin = getDesignSkin()) {
  document.documentElement.dataset.designSkin = skin;
}

export function setDesignSkin(skin: DesignSkin) {
  window.localStorage.setItem(STORAGE_KEY, skin);
  applyDesignSkin(skin);
}
