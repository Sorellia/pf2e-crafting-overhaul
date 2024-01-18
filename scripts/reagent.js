import { calculateDifference, subtractCoins } from "./coins.js";
import { MODULE_NAME, reagentValue } from "./constants.js";


/**
 * Iterates through an actor's inventory, returning all available Reagents.
 * 
 * @param {ActorPF2e} actor The actor whose inventory to look through.
 * @returns {EquipmentPF2e[]} An array of Reagents. Can be empty.
 */
export function getReagents(actor) {
    return actor.itemTypes.equipment.filter(equipment => equipment.flags[MODULE_NAME] && equipment.flags[MODULE_NAME].isReagent == true);
}

/**
 * Summarises the values of an array of Regants. Accounts for leftovers too.
 * 
 * @param {EquipmentPF2e[]} reagents An array of equipment who (presumably) all have the `isMaterialTrove` flag -- though this is actually not mandatory.
 * @returns {game.pf2e.Coins} A Coins object of the accumulated overall value.
 */
export function getReagentValue(reagents) {
    let accumulatedValue = new game.pf2e.Coins();

    reagents.map(reagent => {
        return game.pf2e.Coins.fromPrice(reagent.system.price, reagent.system.quantity)
            .add(game.pf2e.Coins.fromString(reagent.flags[MODULE_NAME]?.leftovers || "0 gp"))
    }).forEach(indVal => {
        accumulatedValue = accumulatedValue.add(indVal);
    });

    return accumulatedValue;
}

/**
 * A convenience function that suggests the Bulk of a Reagent of a given level to represent a material value, marking any leftovers.
 * 
 * @param {number} reagentLevel The level of the Reagent. Determines how much value can be "packed" inside one Bulk.
 * @param {game.pf2e.Coins} newValue The value the Reagent should represent. 
 * @returns {{quantity: number, leftovers: game.pf2e.Coins}} An anonymous struct of two values.  
 * - `quantity` measures the Bulk the reagent should be, with the tens being actual Bulk values, and the ones being X amount of Light Bulk (so, `quantity = 14` would be 1 + 4L Bulk).  
 * - `leftovers` is the amount of Coins that could not be neatly fit into the Bulk, and should be kept track of separately.
 */
export function changeReagentValue(reagentLevel, newValue) {
    const oneLbulk = reagentValue(reagentLevel);
    const bulk = newValue.copperValue / oneLbulk.copperValue;
    const roundedBulk = Math.floor(bulk);

    return {
        quantity: roundedBulk,
        leftovers: subtractCoins(newValue, oneLbulk.scale(roundedBulk))
    }
}

/**
 * Determines if a certain cost could be paid with the value contained in Reagents.
 * 
 * @param {EquipmentPF2e[]} reagents The array of Reagents to use to pay the cost. 
 * @param {game.pf2e.Coins} CoinsToPay The Coins object of the cost to pay.
 * @param {boolean} fullCommit Defaults to true. If it's true, the function will prematurely quit if it cannot pay the full cost. If false, it will pay as much as it can, and report back that it CAN pay the cost (even if it cannot in actuality).
 * @returns {{canPay: boolean, updates: EmbeddedDocumentUpdateData[]}} An anonymous struct of two values.  
 * - `canPay` is true if the Reagents can be used to pay the cost (most of the time, see `fullCommit`).  
 * - `updates` is an array of embedded item updates that remove value from the Reagents, to be called at the caller's leisure with actor.updateEmbeddedDocuments("Item", updates).
 */
export function payWithReagents(reagents, CoinsToPay, fullCommit = true) {
    let updates = [];
    let remainingPayment = CoinsToPay;

    if (subtractCoins(getReagentValue(reagents), CoinsToPay).copperValue < 0 && fullCommit) {
        return {
            canPay: false,
            updates
        };
    }

    let reagentSummaries = reagents.map(reagent => {
        return {
            id: reagent.id,
            level: reagent.level,
            quantity: reagent.quantity,
            value: getTroveValue([reagent])
        };
    }).sort((a, b) =>
        a.level - b.level
    );

    let i = 0;
    while (i < reagentSummaries.length && remainingPayment.copperValue > 0) {
        const removeFromReagent = subtractCoins(reagentSummaries[i].value, remainingPayment).copperValue < 0 ? reagentSummaries[i].value : remainingPayment;
        const remainsInReagent = subtractCoins(reagentSummaries[i].value, removeFromReagent);
        const newReagentData = changeTroveValue(reagentSummaries[i].level, remainsInReagent);

        remainingPayment = subtractCoins(remainingPayment, removeFromReagent);

        updates.push({
            _id: reagentSummaries[i].id,
            "system.quantity": newReagentData.quantity,
            [`flags.${MODULE_NAME}.leftovers`]: newReagentData.leftovers.toString()
        });

        i++;
    }

    if (remainingPayment.copperValue > 0 && fullCommit) {
        return {
            canPay: false,
            updates: []
        };
    } else {
        return {
            canPay: true,
            updates
        };
    }
}

/**
 * Determines of a cost could be paid with Reagents, Coins, or a mix of both.
 * 
 * @param {"fullCoin" | "preferCoin" | "preferReagent" | "fullReagent" | "free"} paymentOption Determines what should be the preferred way of handling the cost.  
 * - `fullCoin` will only attempt to pay the cost in coins.
 * - `preferCoin` will attempt to pay the cost in coins, then if that's not enough, will attempt to pay the remainder with Material Troves.
 * - `preferReagent` is the reverse of the above.
 * - `fullReagent` will only attempt to pay with Reagents. This is quite literally just payWithReagents().
 * - `free` ignores the costs altogether, and will always "pay" them.
 * @param {game.pf2e.Coins} actorCoins The Coins object to use when paying with coins. Doesn't actually have to come from an actor.
 * @param {EquipmentPF2e[]} reagents An array of equipment with the isMaterialTrove flag (but doesn't actually have to be that). 
 * @param {game.pf2e.Coins} costCoins The Coins object of the cost that must be paid. 
 * @returns {{canPay: boolean, removeCopper: number, reagentUpdates: EmbeddedDocumentUpdateData[]}} An anonymous struct of three values.  
 * - `canPay` is true if the cost could be paid using the `paymentOption`.  
 * - `removeCopper` is the amount of copper to remove from the (presumed) actor.
 * - `reagentUpdates` is almost literally payWithReagents()'s `updates`, see that for more details.
 */
export function payWithCoinsAndReagents(paymentOption, actorCoins, reagents, costCoins) {
    let canPay = false;
    let removeCopper = 0;
    let reagentUpdates = [];

    switch (paymentOption) {
        case "fullCoin":
            {
                const payment = calculateDifference(costCoins, actorCoins);
                if (payment <= 0) {
                    canPay = true;
                    removeCopper = costCoins.copperValue;
                }
            }
            break;
        case "preferCoin":
            {
                const payment = calculateDifference(costCoins, actorCoins);
                if (payment.copperValue <= 0) {
                    canPay = true;
                    removeCopper = costCoins.copperValue;
                } else {
                    const canPayReagent = payWithReagents(reagents, payment);
                    canPay = canPayReagent.canPay;
                    reagentUpdates = canPayReagent.updates;
                    removeCopper = actorCoins.copperValue;
                }
            }
            break;
        case "preferTrove":
            {
                const payment = payWithReagents(reagents, costCoins);

                if (payment.canPay) {
                    canPay = payment.canPay;
                    reagentUpdates = payment.updates;
                } else {
                    const partialPayment = payWithReagents(reagents, costCoins, false);
                    const coinsNeeded = subtractCoins(costCoins, getReagentValue(reagents));

                    if (subtractCoins(coinsNeeded, actorCoins).copperValue <= 0) {
                        canPay = true;
                        removeCopper = coinsNeeded.copperValue;
                        reagentUpdates = partialPayment.updates;
                    }
                }
            }
            break;
        case "fullTrove":
            {
                const canPayReagent = payWithReagents(reagents, costCoins);
                canPay = canPayReagent.canPay;
                reagentUpdates = canPayReagent.updates;
            }
            break;
        case "free":
            {
                canPay = true;
            }
        default:
            break;
    }

    return {
        canPay,
        removeCopper,
        reagentUpdates
    };
}