import * as fs from "fs";
import * as path from "path";

export interface AppConfig {
  adminRole: string;
}

export const getConfig = (): AppConfig => {
  const configPath = path.join(__dirname, "config.json");
  const configFile = fs.readFileSync(configPath, "utf8");
  return JSON.parse(configFile) as AppConfig;
};
