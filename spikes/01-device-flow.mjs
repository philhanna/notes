// Phase 0 spike 1 (impl.md): prove a static browser app can complete GitHub
// App device flow and call the API with no client secret. Throwaway script,
// not application code. Run: node spikes/01-device-flow.mjs
import { mkdir, writeFile } from "node:fs/promises";

const CLIENT_ID = process.env.SPIKE_CLIENT_ID ?? "Iv23liBOOsS7SnBaH9d2";
const REPO = process.env.SPIKE_REPO ?? "philhanna/notes-data";
const TOKEN_DIR = new URL("./.local/", import.meta.url);
const TOKEN_FILE = new URL("./token.json", TOKEN_DIR);

async function requestDeviceCode() {
  const response = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ client_id: CLIENT_ID }),
  });

  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(
      `device/code failed: ${response.status} ${JSON.stringify(body)}`,
    );
  }
  return body;
}

async function pollForToken(deviceCode, intervalSeconds) {
  let interval = intervalSeconds;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));

    const response = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      },
    );

    const body = await response.json();

    if (body.access_token) {
      return body;
    }
    if (body.error === "authorization_pending") {
      continue;
    }
    if (body.error === "slow_down") {
      interval = body.interval ?? interval + 5;
      continue;
    }
    throw new Error(`device flow failed: ${JSON.stringify(body)}`);
  }
}

async function verifyToken(accessToken) {
  const userResponse = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const user = await userResponse.json();
  if (!userResponse.ok) {
    throw new Error(
      `GET /user failed: ${userResponse.status} ${JSON.stringify(user)}`,
    );
  }

  const repoResponse = await fetch(`https://api.github.com/repos/${REPO}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const repo = await repoResponse.json();

  return {
    login: user.login,
    repoAccessible: repoResponse.ok,
    repoStatus: repoResponse.status,
    repoPrivate: repo.private,
    repoDefaultBranch: repo.default_branch,
  };
}

async function main() {
  const device = await requestDeviceCode();
  console.log("\nOpen this URL and enter the code below:");
  console.log(`  ${device.verification_uri}`);
  console.log(`  Code: ${device.user_code}`);
  console.log(`  (expires in ${Math.round(device.expires_in / 60)} minutes)\n`);
  console.log("Waiting for authorization...");

  const token = await pollForToken(device.device_code, device.interval ?? 5);
  console.log("Authorized.");

  await mkdir(TOKEN_DIR, { recursive: true });
  await writeFile(TOKEN_FILE, JSON.stringify(token, null, 2));
  console.log(`Token saved locally (gitignored) at ${TOKEN_FILE.pathname}`);

  const check = await verifyToken(token.access_token);
  console.log("\nVerification (redacted, no token shown):");
  console.log(JSON.stringify(check, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
