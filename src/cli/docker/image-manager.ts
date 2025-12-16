/**
 * Docker image building and caching.
 *
 * Handles:
 * - Building Docker images from Dockerfile content (via dockerode)
 * - Caching image hashes to avoid unnecessary rebuilds
 * - Checking if an image needs to be rebuilt
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { computeDockerfileHash } from "./dockerfile.js";
import { getDockerClient } from "./docker-wrapper.js";
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
 * Builds a Docker image from Dockerfile content using dockerode.
 *
 * Uses dockerode's buildImage API with followProgress for cleaner
 * stream handling compared to manual Bun.spawn + stream consumption.
 *
 * @param imageName - Name/tag for the built image
 * @param dockerfile - Dockerfile content
 * @throws DockerBuildError if build fails
 */
async function buildImage(imageName: string, dockerfile: string): Promise<void> {
  const docker = getDockerClient();

  // Write Dockerfile to cache directory (same location as before)
  ensureCacheDir();
  const dockerfilePath = join(CACHE_DIR, "Dockerfile");
  writeFileSync(dockerfilePath, dockerfile);

  try {
    // Build the image with nocache to ensure Dockerfile changes take effect
    const stream = await docker.buildImage(
      { context: CACHE_DIR, src: ["Dockerfile"] },
      { t: imageName, nocache: true },
    );

    // Collect output for error reporting using dockerode's followProgress helper
    const output: string[] = [];
    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(
        stream,
        // onFinished callback
        (err: Error | null) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        },
        // onProgress callback - collect output for error context
        (event: { stream?: string; error?: string; errorDetail?: { message: string } }) => {
          if (event.stream) {
            output.push(event.stream.trim());
          }
          if (event.error) {
            output.push(`ERROR: ${event.error}`);
            reject(new DockerBuildError(`Docker build failed: ${event.error}`, output.join("\n")));
          }
        },
      );
    });
  } catch (error) {
    if (error instanceof DockerBuildError) {
      throw error;
    }
    const msg = error instanceof Error ? error.message : String(error);
    throw new DockerBuildError(`Docker build failed: ${msg}`, msg);
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
