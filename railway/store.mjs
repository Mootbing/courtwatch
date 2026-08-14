import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const dataPath =
  process.env.DATA_PATH ||
  (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "availability.json")
    : existsSync("/data")
      ? "/data/availability.json"
      : join(process.cwd(), "data", "availability.json"));

export async function readSnapshot() {
  try {
    return JSON.parse(await readFile(dataPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeSnapshot(snapshot) {
  await mkdir(dirname(dataPath), { recursive: true });
  const temporaryPath = `${dataPath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(snapshot, null, 2), "utf8");
  await rename(temporaryPath, dataPath);
}
