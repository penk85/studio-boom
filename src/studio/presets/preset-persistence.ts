// Motion-preset persistence boundary for recorder saves and built-in seeding.
import { db } from "../db";
import type { MotionPreset } from "../types";

export async function loadMotionPreset(id: string): Promise<MotionPreset | undefined> {
  return db.motionPresets.get(id);
}

export async function saveMotionPreset(preset: MotionPreset): Promise<MotionPreset> {
  await db.motionPresets.put(preset);
  return preset;
}
