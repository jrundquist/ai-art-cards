const { notarize } = require("@electron/notarize");
const path = require("path");

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== "darwin") {
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.resolve(appOutDir, `${appName}.app`);

  if (!process.env.APPLE_ID) {
    console.warn("Skipping notarization: APPLE_ID not set");
    return;
  }

  if (!process.env.APPLE_APP_SPECIFIC_PASSWORD) {
    console.warn("Skipping notarization: APPLE_APP_SPECIFIC_PASSWORD not set");
    return;
  }

  if (!process.env.APPLE_TEAM_ID) {
    console.warn("Skipping notarization: APPLE_TEAM_ID not set");
    return;
  }

  console.log(
    `Notarizing ${appName} found at ${appPath} with Apple ID ${process.env.APPLE_ID}`
  );

  return await notarize({
    appBundleId: "tech.rundquist.aiartcards.app",
    appPath: appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
    tool: "notarytool",
  });
};
