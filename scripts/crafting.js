import { getPreferredPaymentMethod, localise, MODULE_NAME, setPreferredPaymentMethod } from "./constants.js";
import { projectBeginDialog, projectCraftDialog, projectEditDialog } from "./dialog.js";
import { normaliseCoins } from "./coins.js";
import { payWithCoinsAndReagents, getReagents } from "./reagent.js";

/**
 * Begins a new project for an actor, adding said project to the flags of the actor, and removing value from the actor's coins / reagents if needed.
 * 
 * When all successful, creates a ChatMessage announcing the beginning of the project, and appends the new project to the actor's projects flag.
 * 
 * @param {ActorPF2e} crafterActor The actor who begins the project. 
 * @param {Object} itemDetails The details of the item to make a project of.
 * @param {string} itemDetails.UUID The UUID of the item.
 * @param {number} itemDetails.batchSize The size of the batch of the item being crafted. Usually 1, 4 or 10, but feats can change this.
 * @param {boolean} skipDialog Defaults to true. If it is, well, it skips the dialog, setting the startingProgress to 0.
 */

export async function beginAProject(crafterActor, itemDetails, skipDialog = true) {
	if (!itemDetails.UUID || itemDetails.UUID === "") {
		console.error("[CCO]: Missing Item UUID when beginning a project!");
		return;
	}
	
	let dialogResult = {};
	if(!skipDialog) {
		dialogResult = await projectBeginDialog(itemDetails, getPreferredPaymentMethod(crafterActor));
	} else {
		dialogResult = { startingProgress: 0 };
	}
	
	if (typeof dialogResult.startingProgress === "undefined") {
		return;
	}
	
	const payment = payWithCoinsAndReagents(
		dialogResult.payMethod,
		new game.pf2e.Coins({ cp: crafterActor.inventory.coins.copperValue }),
		getReagents(crafterActor),
		new game.pf2e.Coins({ cp: dialogResult.startingProgress }));
	
	await setPreferredPaymentMethod(crafterActor, dialogResult.payMethod);
	
	if (!payment.canPay) {
		ui.notifications.warn(localise("ProjectBeginWindow.CannotPay", {name: crafterActor.name}));
		return;
	}
	
	let actorProjects = crafterActor.getFlag(MODULE_NAME, "projects") ?? [];
	
	const newProjects = [
		{
			ID: randomID(),
			ItemUUID: itemDetails.UUID,
			progressInCopper: dialogResult.startingProgress,
			batchSize: itemDetails.batchSize || 1
		}
	];
	
	if (payment.removeCopper > 0) {
		await crafterActor.inventory.removeCoins({cp: payment.removeCopper});
	}
	
	if (payment.reagentUpdates.length > 0) {
		await crafterActor.updateEmbeddedDocuments("Item", payment.reagentUpdates);
	}
	
	ChatMessage.create({
		user: game.user.id,
		content: localise("ProjectBeginWindow.PCStartsAProject", {
			name: crafterActor.name,
			itemName: (await fromUuid(itemDetails.UUID)).name,
			currentValue: normaliseCoins(dialogResult.startingProgress)
		}),
		speaker: {alias: crafterActor.name},
	});
	
	await crafterActor.update({ [`flags.${MODULE_NAME}.projects`]: actorProjects.concat(newProjects) });
	let itemInformation = await fromUuid(itemDetails.UUID);
	itemInformation = itemInformation.system.price.value;
	if (payment.removeCopper === itemInformation.copperValue) {
        progressProject(crafterActor, newProjects[0].ID, true, dialogResult.spendingAmount);	
	}
};

/**
 * Crafts a project -- or rather, handles every related function that is responsible for crafting a project.
 * 
 * @see projectCraftDialog() for the actual adjusting of craft-a-project variables.
 * @see progressProject() for the "skip the check if activity's cost is equal to or larger than the remainder" logic.
 * 
 * @param {ActorPF2e} crafterActor The actor who is crafting the project. 
 * @param {Object} itemDetails The details of the item to make a project of.
 * @param {string} itemDetails.UUID The UUID of the item.
 * @param {string} itemDetails.projectUUID The UUID of the project itself.
 * @param {number} itemDetails.batchSize The size of the batch of the item being crafted. 
 * @param {boolean} skipDialog Defaults to true. Despite that, it's currently unused, and is always called with a false instead.
 * @param {ActorPF2e} projectOwner Who actually owns the project. Defaults to crafterActor, but can be someone else (with crafting as a group). 
 */

export async function craftAProject(crafterActor, itemDetails, skipDialog = true, projectOwner = crafterActor) {
	if (!itemDetails.UUID || itemDetails.UUID === "") {
		console.error("[CCO]: Missing Item UUID when beginning a project!");
		return;
	}

	if (!itemDetails.projectUUID || itemDetails.projectUUID === "") {
		console.error("[CCO]: Missing Project UUID when beginning a project!");
		return;
	}
	
	const actorProjects = projectOwner.getFlag(MODULE_NAME, "projects") ?? [];
	const project = actorProjects.filter(project => project.ID === itemDetails.projectUUID)[0];
	
	if (!project) {
		ui.notifications.error(localise("CraftWindow.DoesNotHaveProjectToCraft", {name: projectOwner.name, projectUUID: itemDetails.projectUUID}));
		return;
	}
	
	let dialogResult = {};
	if (!skipDialog) {
		dialogResult = await projectCraftDialog(crafterActor, itemDetails, new game.pf2e.Coins({ cp: project.progressInCopper }));
	}
	
	const projectCompletion = new game.pf2e.Coins({cp: project.progressInCopper });
	const projectItem = await fromUuid(project.ItemUUID);
    const itemCost = game.pf2e.Coins.fromPrice(projectItem.price, project.batchSize);
	const projectCompletionDelta = itemCost.copperValue - projectCompletion.copperValue;
	
	if (dialogResult.spendingAmount.copperValue === 0 && projectCompletionDelta > 0) {
		ui.notifications.warn(localise("CraftWindow.InputMeaningfulCost"));
		return;
	}
	
	let rushCosts = game.pf2e.Coins.fromString("0 gp");
	
	for (const toggle in dialogResult.toggles) {
		if (dialogResult.toggles.hasOwnProperty(toggle)) {
			rushCosts = rushCosts.add(game.pf2e.Coins.fromString(dialogResult.toggles[toggle].rushCost));
		}
	}
	
	const payment = payWithCoinsAndReagents(
		dialogResult.payMethod,
		crafterActor.inventory.coins,
		getReagents(crafterActor),
		dialogResult.spendingAmount.add(rushCosts));
	
	await setPreferredPaymentMethod(crafterActor, dialogResult.payMethod);
	
	if (!payment.canPay) {
		ui.notifications.warn(localise("CraftWindow.CannotPay", {name: crafterActor.name}));
		return;
	}
	
	if (payment.removeCopper > 0) {
		await crafterActor.inventory.removeCoins({cp: payment.removeCopper});
	}
	
	if (payment.reagentUpdates.length > 0) {
		await crafterActor.updateEmbeddedDocuments("Item", payment.reagentUpdates);
	}
	
    progressProject(projectOwner, project.ID, true, dialogResult.spendingAmount);
};

/**
 * A convenience function to remove a project from an actor.
 * 
 * @param {ActorPF2e} crafterActor The actor to remove a project from. 
 * @param {string} projectUUID The UUID of the project to remove. 
 */

export async function abandonProject(crafterActor, projectUUID) {
    const actorProjects = crafterActor.getFlag(MODULE_NAME, "projects") ?? [];
    await crafterActor.update({ [`flags.${MODULE_NAME}.projects`]: actorProjects.filter(project => project.ID !== projectUUID) });
}

/**
 * Edits an actor's project.
 * 
 * @param {ActorPF2e} crafterActor The actor whose project to edit. 
 * @param {string} projectUUID The UUID of the project to edit. 
 */

export async function editProject(crafterActor, projectUUID) {
    if (!projectUUID || projectUUID === "") {
        console.error("[CCO]: Missing Project UUID when editing a project!");
        return;
    }

    const actorProjects = crafterActor.getFlag(MODULE_NAME, "projects") ?? [];
    const project = actorProjects.filter(project => project.ID === projectUUID)[0];

    if (!project) {
        ui.notifications.error(localise("CharSheet.CannotEditProject", { name: crafterActor.name, projectUUID }));
        return;
    }

    const dialogResult = await projectEditDialog(project);

    if (!dialogResult || dialogResult === "cancel") {
        return;
    }

    project.progressInCopper = dialogResult.progressInCopper < 0 ? project.progressInCopper : dialogResult.progressInCopper;
    project.batchSize = dialogResult.batchSize <= 0 ? project.batchSize : dialogResult.batchSize;

    await crafterActor.update({
        [`flags.${MODULE_NAME}.projects`]: actorProjects.map((currProject => {
            if (currProject.ID !== projectUUID) {
                return currProject;
            } else {
                return project;
            }
        }))
    });
}

/**
 * Formats an actor's projects in a display-ready way.
 * 
 * @param {ActorPF2e} crafterActor The actor whose projects to get.
 * @returns {{
 * projectUuid: string,
 * itemUuid: string,
 * img: string,
 * name: string,
 * cost: game.pf2e.Coins,
 * currentlyDone: number,
 * progress: number}[]} An array of structs with the following data:  
 * - `projectUuid`: the UUID of the project itself.  
 * - `itemUuid`: the UUID of the item the project is about.
 * - `img`: a relative link to the item's image, starting from the default Foundry asset root directory.
 * - `name`: the display-ready name of the item.
 * - `cost`: the overall cost of the project in a Coins object.
 * - `currentlyDone`: the progress on the project in copper.
 * - `progress`: the percentage (going from 0 to 1) of the project's completion.
 */

export async function getProjectsToDisplay(crafterActor) {
    const projects = crafterActor.getFlag(MODULE_NAME, 'projects') ?? [];

    const projectItems = await Promise.all(projects.map(async (project) => {
        const projectItem = await fromUuid(project.ItemUUID);
        const cost = game.pf2e.Coins.fromPrice(projectItem.price, project.batchSize);
        const currentlyDone = normaliseCoins(project.progressInCopper);
        const progress = project.progressInCopper / cost.copperValue * 100;

        return {
            projectUuid: project.ID,
            itemUuid: project.ItemUUID,
            img: projectItem.img,
            name: projectItem.name,
            batch: project.batchSize,
            cost,
            currentlyDone,
            progress
        };
    }))

    return projectItems;
}

/**
 * Advances the project's completion either forwards or backwards.
 * 
 * Can remove the project if the project is completed, or if the project experiences a setback so big,
 * the progress reaches 0 or goes below it.
 * 
 * Announces with a ChatMessage the progress, and if said progress ends the project.
 * 
 * @param {ActorPF2e} crafterActor The actor whose project to progress or regress.
 * @param {string} projectUUID The UUID of the project.
 * @param {boolean} hasProgressed If true, `amount` will be added to the project's current progress.
 * If false, it will be subtracted.
 * @param {string} amount A string of the progressed value, formatted like a Coins object 
 * (so for example, "5 gp, 4 sp"). 
 * @returns 
 */

export async function progressProject(crafterActor, projectUUID, hasProgressed, amount) {
    const actorProjects = crafterActor.getFlag(MODULE_NAME, "projects") ?? [];
    const project = actorProjects.filter(project => project.ID === projectUUID)[0];

    if (!project) {
        ui.notifications.error(localise("CraftWindow.DoesNotHaveProjectToProgress", { name: crafterActor.name, projectUUID: itemDetails.projectUUID }));
        return;
    }

    const coinAmount = game.pf2e.Coins.fromString(amount);
    const projectItem = await fromUuid(project.ItemUUID);
    const cost = game.pf2e.Coins.fromPrice(projectItem.price, project.batchSize);

    if (hasProgressed) {
        project.progressInCopper += coinAmount.copperValue;

        if (project.progressInCopper >= cost.copperValue) {
            const itemObject = projectItem.toObject();
            itemObject.system.quantity = project.batchSize;

            const result = crafterActor.isOwner ? await crafterActor.addToInventory(itemObject, undefined) : "permissionLacking";

            if (!result) {
                ui.notifications.warn(game.i18n.localize("PF2E.Actions.Craft.Warning.CantAddItem"));
                return;
            }

            if (result === "permissionLacking") {
                ChatMessage.create({
                    user: game.user.id,
                    content: localise("CraftWindow.Progress.Finish", { name: crafterActor.name, batchSize: project.batchSize, itemName: projectItem.name }).concat(localise("CraftWindow.Progress.LacksPermissionToFinish", { name: crafterActor.name, playerName: game.user.name })),
                    speaker: { alias: crafterActor.name },
                });
            } else {
                ChatMessage.create({
                    user: game.user.id,
                    content: localise("CraftWindow.Progress.Finish", { name: crafterActor.name, batchSize: project.batchSize, itemName: projectItem.name }),
                    speaker: { alias: crafterActor.name },
                });
                await abandonProject(crafterActor, projectUUID);
            }
        } else {
            ChatMessage.create({
                user: game.user.id,
                content: localise("CraftWindow.Progress.Progress", {
                    name: crafterActor.name,
                    batchSize: project.batchSize,
                    itemName: projectItem.name,
                    progressAmount: coinAmount.toString(),
                    currentProgress: normaliseCoins(project.progressInCopper),
                    goal: cost.toString()
                }),
                speaker: { alias: crafterActor.name },
            });
            await crafterActor.update({
                [`flags.${MODULE_NAME}.projects`]: actorProjects.map((currProject => {
                    if (currProject.ID !== projectUUID) {
                        return currProject;
                    } else {
                        return project;
                    }
                }))
            });
        }
    } else {
        project.progressInCopper -= coinAmount.copperValue;

        if (project.progressInCopper <= 0) {
            ChatMessage.create({
                user: game.user.id,
                content: localise("CraftWindow.Progress.FatalSetback", { name: crafterActor.name, batchSize: project.batchSize, itemName: projectItem.name }),
                speaker: { alias: crafterActor.name },
            });
            await abandonProject(crafterActor, projectUUID);
        } else {
            ChatMessage.create({
                user: game.user.id,
                content: localise("CraftWindow.Progress.Progress", {
                    name: crafterActor.name,
                    batchSize: project.batchSize,
                    itemName: projectItem.name,
                    progressAmount: coinAmount.toString(),
                    currentProgress: normaliseCoins(project.progressInCopper),
                    goal: cost.toString()
                }),
                speaker: { alias: crafterActor.name },
            });
            await crafterActor.update({
                [`flags.${MODULE_NAME}.projects`]: actorProjects.map((currProject => {
                    if (currProject.ID !== projectUUID) {
                        return currProject;
                    } else {
                        return project;
                    }
                }))
            });
        }
    }
}