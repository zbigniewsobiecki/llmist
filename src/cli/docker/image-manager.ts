/**
 * Docker image building and caching.
 *
 * Handles:
 * - Building Docker images from Dockerfile content
 * - Caching image hashes to avoid unnecessary rebuilds
 * - Checking if an image needs to be rebuilt
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { computeDockerfileHash } from "./dockerfile.js";
import { DEFAULT_IMAGE_NAME } from "./types.js";

/**
 * Cache directory for Docker-related files.
 */
const CACHE_DIR = join(homedir(), ".llmist", "docker-cache");

/**
 * File storing the current image hash.
 */
const HASH_FILE = "image-hash.json";

/**
 * Cache entry structure.
 */
interface CacheEntry {
  imageName: string;
  dockerfileHash: string;
  builtAt: string;
}

/**
 * Ensures the cache directory exists.
 */
function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/**
 * Gets the cached hash for an image name.
 *
 * @param imageName - Docker image name
 * @returns Cached dockerfile hash, or undefined if not cached
 */
function getCachedHash(imageName: string): string | undefined {
  const hashPath = join(CACHE_DIR, HASH_FILE);

  if (!existsSync(hashPath)) {
    return undefined;
  }

  try {
    const content = readFileSync(hashPath, "utf-8");
    const cache = JSON.parse(content) as Record<string, CacheEntry>;
    return cache[imageName]?.dockerfileHash;
  } catch {
    return undefined;
  }
}

/**
 * Saves the hash for an image name to cache.
 *
 * @param imageName - Docker image name
 * @param hash - Dockerfile hash
 */
function setCachedHash(imageName: string, hash: string): void {
  ensureCacheDir();
  const hashPath = join(CACHE_DIR, HASH_FILE);

  let cache: Record<string, CacheEntry> = {};

  if (existsSync(hashPath)) {
    try {
      const content = readFileSync(hashPath, "utf-8");
      cache = JSON.parse(content) as Record<string, CacheEntry>;
    } catch {
      // Start fresh on parse error
      cache = {};
    }
  }

  cache[imageName] = {
    imageName,
    dockerfileHash: hash,
    builtAt: new Date().toISOString(),
  };

  writeFileSync(hashPath, JSON.stringify(cache, null, 2));
}

/**
 * Error thrown when Docker image building fails.
 */
export class DockerBuildError extends Error {
  constructor(
    message: string,
    public readonly output: string,
  ) {
    super(message);
    this.name = "DockerBuildError";
  }
}

/**
 * Builds a Docker image from Dockerfile content.
 *
 * @param imageName - Name/tag for the built image
 * @param dockerfile - Dockerfile content
 * @throws DockerBuildError if build fails
 */
async function buildImage(imageName: string, dockerfile: string): Promise<void> {
  // Write Dockerfile to temp location
  ensureCacheDir();
  const dockerfilePath = join(CACHE_DIR, "Dockerfile");
  writeFileSync(dockerfilePath, dockerfile);

  // Build the image
  const proc = Bun.spawn(["docker", "build", "-t", imageName, "-f", dockerfilePath, CACHE_DIR], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  if (exitCode !== 0) {
    const output = [stdout, stderr].filter(Boolean).join("\n");
    throw new DockerBuildError(`Docker build failed with exit code ${exitCode}`, output);
  }
}

/**
 * Ensures the Docker image is built and up-to-date.
 *
 * Checks if the cached Dockerfile hash matches the current content.
 * If not, rebuilds the image.
 *
 * @param imageName - Docker image name (defaults to DEFAULT_IMAGE_NAME)
 * @param dockerfile - Dockerfile content
 * @returns The image name (for chaining)
 * @throws DockerBuildError if build fails
 */
export async function ensureImage(
  imageName: string = DEFAULT_IMAGE_NAME,
  dockerfile: string,
): Promise<string> {
  const hash = computeDockerfileHash(dockerfile);
  const cachedHash = getCachedHash(imageName);

  if (cachedHash === hash) {
    // Image is up-to-date
    return imageName;
  }

  // Need to build/rebuild
  console.error(`Building Docker image '${imageName}'...`);
  await buildImage(imageName, dockerfile);

  // Update cache
  setCachedHash(imageName, hash);

  console.error(`Docker image '${imageName}' built successfully.`);
  return imageName;
}

/**
 * Checks if an image needs to be rebuilt.
 *
 * @param imageName - Docker image name
 * @param dockerfile - Dockerfile content
 * @returns true if rebuild is needed
 */
export function needsRebuild(imageName: string, dockerfile: string): boolean {
  const hash = computeDockerfileHash(dockerfile);
  const cachedHash = getCachedHash(imageName);
  return cachedHash !== hash;
}

/**
 * Clears the image cache for a specific image or all images.
 *
 * @param imageName - Image name to clear, or undefined to clear all
 */
export function clearImageCache(imageName?: string): void {
  const hashPath = join(CACHE_DIR, HASH_FILE);

  if (!existsSync(hashPath)) {
    return;
  }

  if (imageName) {
    try {
      const content = readFileSync(hashPath, "utf-8");
      const cache = JSON.parse(content) as Record<string, CacheEntry>;
      delete cache[imageName];
      writeFileSync(hashPath, JSON.stringify(cache, null, 2));
    } catch {
      // Ignore errors
    }
  } else {
    // Clear all
    writeFileSync(hashPath, "{}");
  }
}
