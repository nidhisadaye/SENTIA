import AsyncStorage from "@react-native-async-storage/async-storage";

export type GuardianContact = { name: string; phone: string };

const GUARDIANS_KEY = "sentia_guardians_v2";
export const MAX_GUARDIANS = 3;

export async function loadGuardians(): Promise<GuardianContact[]> {
  const raw = await AsyncStorage.getItem(GUARDIANS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as GuardianContact[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_GUARDIANS) : [];
  } catch {
    return [];
  }
}

export async function saveGuardians(guardians: GuardianContact[]): Promise<void> {
  await AsyncStorage.setItem(GUARDIANS_KEY, JSON.stringify(guardians.slice(0, MAX_GUARDIANS)));
}

export async function addGuardian(guardian: GuardianContact): Promise<GuardianContact[]> {
  const current = await loadGuardians();
  const next = [...current, guardian].slice(0, MAX_GUARDIANS);
  await saveGuardians(next);
  return next;
}

export async function removeGuardian(index: number): Promise<GuardianContact[]> {
  const current = await loadGuardians();
  const next = current.filter((_, i) => i !== index);
  await saveGuardians(next);
  return next;
}