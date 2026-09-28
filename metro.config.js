const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);
const forceWriteFileSystem = process.env.NATIVEWIND_FORCE_WRITE_FILE_SYSTEM !== "false";

module.exports = withNativeWind(config, {
  input: "./global.css",
  forceWriteFileSystem,
});
