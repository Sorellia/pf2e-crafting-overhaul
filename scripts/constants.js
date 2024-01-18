/** 
 * A constant handle for the module name if I ever end up changing it. 
 *
 * **WARNING!** If this changes, you HAVE to change the macros and reagents too.
 */
export const MODULE_NAME = "pf2e-crafting-overhaul";

/** 
 * The value of a reagent by its source leevel. Note that THAT table starts at level -1, but arrays obviously start at 0.
 */
export const ReagentLevelledValue = [
    "1 gp ", "2 gp", "4 gp", "7 gp", "12 gp", "20 gp", "30 gp", "50 gp", "70 gp", "110 gp", "150 gp", "180 gp", "300 gp", "420 gp", "600 gp", "950 gp", "1300 gp", "1800 gp", "2500 gp", "5000 gp", "7500 gp", "10000 gp"
];

/**
 * Calculate the appropriate value of a reagent based on its level
 * @param (number) level; the level at which the activity is performed to gather a reagent, and the level of the reagent itself
 */
export function reagentValue(level) {
	if (level <= 0 || level >= 21) {
		return new game.pf2e.Coins();
	}
	
	return game.pf2e.Coins.fromString(ReagentLevelledValue[level + 2]);
}

/**
 * Checks if an actor has a feat.
 * 
 * @param {ActorPF2e} actor The actor whose feats to check.
 * @param {string} slug The slug of the feat to check. 
 * Also checks for a sluggified name because most Heroic Crafting feats have no slugs.
 * @returns {boolean} True if the feat exists. 
 */
export function CheckFeat(actor, slug) {
    return actor.itemTypes.feat.some((i) => i.slug === slug || game.pf2e.system.sluggify(i.name) === slug);
}

/**
 * Gets the preferred pay method of an actor.
 * 
 * @param {ActorPF2e} actor The actor whose preferred pay method to check.
 * @returns {"fullCoin" | "preferCoin" | "preferReagents" | "fullReagents" | "free"} The preferred pay method.
 */
export function getPreferredPaymentMethod(actor) {
    return actor.getFlag(MODULE_NAME, "preferredPayMethod") ?? "fullCoin";
}

/**
 * Sets the preferred pay method of an actor.
 * 
 * @param {ActorPF2e} actor The actor whose preferred pay method to set. 
 * @param {"fullCoin" | "preferCoin" | "preferReagents" | "fullReagents" | "free"} preferredPayMethod The preferred pay method.
 */
export async function setPreferredPaymentMethod(actor, preferredPayMethod = "fullCoin") {
    await actor.update({ [`flags.${MODULE_NAME}.preferredPayMethod`]: preferredPayMethod });
}

/// Quick and easy way to localise stuff.
export const localise = (key, data = null) => game.i18n.format("PF2E-CCO." + key, data)