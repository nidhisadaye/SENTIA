import type { LangKey } from "../types";
import { D } from "../dialogue";
import { recordAndTranscribe, collapseSpelledLetters, parseYesNo, prepareRecordingSession } from "./sttService";
import { loadGuardians, addGuardian, removeGuardian, MAX_GUARDIANS, type GuardianContact } from "./sosService";

export type SosFlowIO = {
  lang: LangKey;
  groqKey: string;
  speakAndWait: (text: string) => Promise<void>;
};

const say = (io: SosFlowIO, key: string, value?: string) => {
  const text = value ? D(key, io.lang).replace("{value}", value).replace("{count}", value) : D(key, io.lang);
  return io.speakAndWait(text);
};

const sayRaw = (io: SosFlowIO, key: string, replacements: Record<string, string>) => {
  let text = D(key, io.lang);
  Object.entries(replacements).forEach(([token, val]) => {
    text = text.replace(`{${token}}`, val);
  });
  return io.speakAndWait(text);
};

const listen = (io: SosFlowIO, ms = 5000, digitsOnly = false) =>
  recordAndTranscribe(io.lang, io.groqKey, ms, { digitsOnly });

const parseAddOrDelete = (text: string): "add" | "delete" | "unclear" => {
  const t = text.toLowerCase().trim();
  const addWords = ["add", "जोड़", "जोडा", "add karo", "जोड़ो"];
  const deleteWords = ["delete", "remove", "हटा", "काढा", "हटाओ"];
  if (deleteWords.some((w) => t.includes(w))) return "delete";
  if (addWords.some((w) => t.includes(w))) return "add";
  return "unclear";
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3,
  एक: 1, दो: 2, तीन: 3,
  दोन: 2, तीन3: 3,
};

const parseGuardianChoice = (text: string, guardians: GuardianContact[]): number => {
  const t = text.toLowerCase().trim();
  const digitMatch = t.match(/\d+/);
  if (digitMatch) {
    const n = parseInt(digitMatch[0], 10);
    if (n >= 1 && n <= guardians.length) return n - 1;
  }
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (t.includes(word) && value <= guardians.length) return value - 1;
  }
  const byName = guardians.findIndex((g) => t.includes(g.name.toLowerCase()));
  if (byName >= 0) return byName;
  return -1;
};

async function captureWithConfirmAndSpell(
  io: SosFlowIO, promptKey: string, confirmKey: string, digitsOnly = false,
): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await say(io, promptKey);
    const raw = await listen(io, digitsOnly ? 6000 : 5000, digitsOnly);
    const value = digitsOnly ? raw.replace(/\D/g, "") : raw.trim();
    if (!value) { await say(io, "guardian_didnt_hear"); continue; }

    await say(io, confirmKey, digitsOnly ? value.split("").join(" ") : value);
    if (parseYesNo(await listen(io, 4000)) === "yes") return value;

    await say(io, digitsOnly ? "guardian_phone_spell" : "guardian_spell_prompt");
    const spelledRaw = await listen(io, 6000, digitsOnly);
    const spelled = digitsOnly ? spelledRaw.replace(/\D/g, "") : collapseSpelledLetters(spelledRaw);
    if (!spelled) continue;

    await say(io, confirmKey, digitsOnly ? spelled.split("").join(" ") : spelled);
    if (parseYesNo(await listen(io, 4000)) === "yes") return spelled;
  }
  return null;
}

async function runAddFlow(io: SosFlowIO, guardians: GuardianContact[]): Promise<GuardianContact[]> {
  let list = guardians;
  while (list.length < MAX_GUARDIANS) {
    const name = await captureWithConfirmAndSpell(io, "guardian_name_prompt", "guardian_name_confirm");
    if (!name) break;
    const phone = await captureWithConfirmAndSpell(io, "guardian_phone_prompt", "guardian_phone_confirm", true);
    if (!phone) break;
    list = await addGuardian({ name, phone });
    await say(io, "guardian_saved", name);

    if (list.length >= MAX_GUARDIANS) {
      await say(io, "guardian_max_reached");
      break;
    }

    await say(io, "guardian_add_another");
    const wantsMore = parseYesNo(await listen(io, 5000));
    if (wantsMore !== "yes") break;
  }
  return list;
}

async function runDeleteFlow(io: SosFlowIO, guardians: GuardianContact[]): Promise<GuardianContact[]> {
  if (guardians.length === 0) return guardians;

  const listText = guardians.map((g, i) => `${i + 1}. ${g.name}`).join(", ");
  await sayRaw(io, "guardian_delete_list", { list: listText });

  let idx = -1;
  for (let attempt = 0; attempt < 3 && idx < 0; attempt += 1) {
    if (attempt > 0) await say(io, "guardian_which_delete_retry");
    const heard = await listen(io, 5000);
    idx = parseGuardianChoice(heard, guardians);
  }

  if (idx < 0) {
    await say(io, "guardian_choice_not_understood");
    return guardians;
  }

  const target = guardians[idx];
  await say(io, "guardian_delete_confirm", target.name);
  const confirm = parseYesNo(await listen(io, 4000));
  if (confirm !== "yes") {
    await say(io, "guardian_delete_cancelled", target.name);
    return guardians;
  }
  const updated = await removeGuardian(idx);
  await say(io, "guardian_deleted", target.name);
  return updated;
}

export async function runGuardianSetup(io: SosFlowIO): Promise<GuardianContact[]> {
  await prepareRecordingSession();
  let guardians = await loadGuardians();

  if (guardians.length === 0) {
    await say(io, "guardian_add_prompt");
    const wantsToAdd = parseYesNo(await listen(io, 5000));
    if (wantsToAdd === "yes") guardians = await runAddFlow(io, guardians);
  } else if (guardians.length < MAX_GUARDIANS) {
    await sayRaw(io, "guardian_menu_nonzero", { count: String(guardians.length) });
    const choice = parseAddOrDelete(await listen(io, 5000));
    if (choice === "add") guardians = await runAddFlow(io, guardians);
    else if (choice === "delete") guardians = await runDeleteFlow(io, guardians);
  } else {
    await say(io, "guardian_menu_full");
    const choice = parseAddOrDelete(await listen(io, 5000));
    if (choice === "delete") guardians = await runDeleteFlow(io, guardians);
  }

  await say(io, "guardian_setup_done");
  return guardians;
}