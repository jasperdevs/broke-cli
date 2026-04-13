interface NpmSearchResponse {
  objects?: Array<{
    package?: {
      name?: string;
      version?: string;
      description?: string;
    };
  }>;
}

interface NpmPackageManifest {
  name?: string;
  version?: string;
  description?: string;
  pi?: {
    extensions?: string[] | string;
    skills?: string[] | string;
    prompts?: string[] | string;
    themes?: string[] | string;
  };
}

export interface PackageSearchResult {
  source: string;
  name: string;
  version: string;
  description: string;
  resources: {
    extensions: number;
    skills: number;
    prompts: number;
    themes: number;
  };
}

function normalizeManifestEntries(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function summarizeResources(manifest: NpmPackageManifest): PackageSearchResult["resources"] {
  const pi = manifest.pi ?? {};
  return {
    extensions: normalizeManifestEntries(pi.extensions).length,
    skills: normalizeManifestEntries(pi.skills).length,
    prompts: normalizeManifestEntries(pi.prompts).length,
    themes: normalizeManifestEntries(pi.themes).length,
  };
}

function totalResources(result: PackageSearchResult): number {
  return result.resources.extensions
    + result.resources.skills
    + result.resources.prompts
    + result.resources.themes;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}

export async function searchPackageRegistry(query: string, limit = 10): Promise<PackageSearchResult[]> {
  const normalized = query.trim();
  if (!normalized) return [];

  const search = await fetchJson<NpmSearchResponse>(
    `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(normalized)}&size=${Math.max(1, Math.min(limit, 25))}`,
  );
  const packages = (search?.objects ?? [])
    .map((entry) => entry.package)
    .filter((entry): entry is { name: string; version?: string; description?: string } => typeof entry?.name === "string" && entry.name.length > 0);
  if (packages.length === 0) return [];

  const manifests = await Promise.all(
    packages.map(async (pkg) => {
      const manifest = await fetchJson<NpmPackageManifest>(`https://registry.npmjs.org/${encodeURIComponent(pkg.name!)}/latest`);
      const effective = manifest ?? pkg;
      return {
        source: `npm:${pkg.name!}`,
        name: pkg.name!,
        version: effective.version?.trim() || pkg.version?.trim() || "unknown",
        description: effective.description?.trim() || pkg.description?.trim() || "",
        resources: summarizeResources(manifest ?? {}),
      } satisfies PackageSearchResult;
    }),
  );

  return manifests
    .sort((left, right) =>
      totalResources(right) - totalResources(left)
      || left.name.localeCompare(right.name))
    .slice(0, limit);
}
