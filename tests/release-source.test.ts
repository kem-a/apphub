import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { forgeSourceReleases } from "#scripts/releases/forge";
import { normalizeDate, selectCurrent, type SourceRelease } from "#scripts/releases/model";
import type { App, ReleaseLock } from "#catalog/schema";

const releases: SourceRelease[] = [
  {
    version: "3.0",
    publishedAt: "2026-03-01T00:00:00Z",
    page: "https://example.org/3.0",
    artifacts: [],
  },
  {
    version: "2.0",
    publishedAt: "2026-02-01T00:00:00Z",
    page: "https://example.org/2.0",
    artifacts: [],
  },
  {
    version: "1.0",
    publishedAt: "2026-01-01T00:00:00Z",
    page: "https://example.org/1.0",
    artifacts: [],
  },
];

function lock(version?: string, publishedAt = "2026-01-01T00:00:00Z"): ReleaseLock {
  return {
    appId: "org.example.App",
    releases: version
      ? [
          {
            version,
            publishedAt,
            page: "https://example.org/recorded",
            artifacts: [],
          },
        ]
      : [],
  };
}

test("normalizes timestamps with offsets", () => {
  assert.equal(normalizeDate("2026-08-20T10:49:50+02:00"), "2026-08-20T08:49:50.000Z");
  assert.equal(normalizeDate("2026-08-20T08:49:50Z"), "2026-08-20T08:49:50Z");
});

describe("current releases", () => {
  test("selects only the latest release for a new app", () => {
    assert.deepEqual(selectCurrent(releases, lock(), "fixture"), [releases[0]!]);
  });

  test("keeps only the latest release after an update", () => {
    assert.deepEqual(selectCurrent(releases, lock("2.0"), "fixture"), [releases[0]!]);
  });

  test("rejects invalid release histories", () => {
    assert.throws(
      () => selectCurrent([releases[0]!, releases[0]!], lock(), "fixture"),
      /versions are not unique/
    );
    assert.throws(
      () => selectCurrent([...releases].reverse(), lock(), "fixture"),
      /not ordered newest first/
    );
    assert.throws(
      () => selectCurrent(releases, lock("missing", "2026-03-01T00:00:00Z"), "fixture"),
      /recorded current release is no longer available/
    );
  });
});

type ForgeRelease = Parameters<typeof forgeSourceReleases>[2][number];

const appImage = {
  id: "20000",
  name: "oss-Bitwarden-2026.10.0-x86_64.AppImage",
  browser_download_url:
    "https://github.com/bitwarden/clients/releases/download/desktop-v2026.10.0/oss-Bitwarden-2026.10.0-x86_64.AppImage",
  size: 100,
};

function forgeRelease(
  version: string,
  publishedAt: string,
  assets: ForgeRelease["assets"] = []
): ForgeRelease {
  return {
    id: version,
    tag_name: version,
    published_at: publishedAt,
    html_url: `https://github.com/bitwarden/clients/releases/tag/${version}`,
    draft: false,
    prerelease: false,
    assets,
  };
}

const channelReleases = [
  forgeRelease("cli-v2026.11.1", "2026-11-20T00:00:00Z"),
  forgeRelease("browser-v2026.11.0", "2026-11-15T00:00:00Z"),
  forgeRelease("desktop-v2026.10.0", "2026-11-10T00:00:00Z", [appImage]),
];

const bitwarden = {
  id: "com.bitwarden.desktop",
  releaseSource: {
    type: "github",
    repository: "bitwarden/clients",
    tags: "desktop-v*",
  },
} as App;

const emptyLock = { appId: bitwarden.id, releases: [] } satisfies ReleaseLock;

describe("release tag filters", () => {
  test("selects the newest release from the configured channel", () => {
    const releases = forgeSourceReleases(bitwarden, emptyLock, channelReleases);

    assert.deepEqual(
      releases.map(({ version }) => version),
      ["desktop-v2026.10.0"]
    );
    assert.deepEqual(
      releases[0]?.artifacts.map(({ architecture, name }) => [architecture, name]),
      [["x86_64", appImage.name]]
    );
  });

  test("fails when no release matches the configured channel", () => {
    assert.throws(
      () =>
        forgeSourceReleases(
          bitwarden,
          emptyLock,
          channelReleases.filter(({ tag_name }) => !tag_name.startsWith("desktop-"))
        ),
      /no stable release found/
    );
  });

  test("without a filter the newest channel is considered", () => {
    const untagged = {
      ...bitwarden,
      releaseSource: {
        type: "github",
        repository: "bitwarden/clients",
      },
    } as App;

    assert.throws(
      () => forgeSourceReleases(untagged, emptyLock, channelReleases),
      /no AppImage assets found/
    );
  });
});
