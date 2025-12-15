# Docker Sandboxing

Run llmist agents inside isolated Docker containers for security. This prevents agents from having unrestricted access to your filesystem and system commands.

## Why Use Docker Sandboxing?

When agents have access to gadgets like `RunCommand`, `WriteFile`, or `EditFile`, they can potentially:
- Execute arbitrary shell commands
- Modify or delete files outside the working directory
- Access sensitive data

Docker sandboxing mitigates these risks by:
- Mounting only specific directories (read-only or read-write)
- Running in an isolated environment
- Limiting what tools are available

## Quick Start

Enable Docker sandboxing in your `~/.llmist/cli.toml`:

```toml
[docker]
enabled = true
```

Now all `agent` commands run inside a container:

```bash
llmist agent "List files in the current directory"
# Runs inside Docker with CWD mounted
```

## CLI Flags

Override config settings with command-line flags:

| Flag | Description |
|------|-------------|
| `--docker` | Enable Docker for this command |
| `--docker-ro` | Enable Docker with read-only CWD mount |
| `--no-docker` | Disable Docker (override config) |

```bash
# One-off Docker run
llmist agent --docker "What files are here?"

# Read-only mode for safety
llmist agent --docker-ro "Review the code in src/"

# Disable Docker even if enabled in config
llmist agent --no-docker "Run npm install"
```

## Configuration Options

Full `[docker]` section reference:

```toml
[docker]
# Enable/disable Docker sandboxing globally
enabled = true

# Mount permissions for current working directory
# "rw" = read-write (default), "ro" = read-only
cwd-permission = "rw"

# Mount permissions for ~/.llmist config directory
# "ro" = read-only (default, recommended), "rw" = read-write
config-permission = "ro"

# Forward environment variables into the container
# Useful for API keys, tokens, etc.
env-vars = ["GH_TOKEN", "MY_API_KEY"]

# Additional directory mounts
# [[docker.mounts]]
# source = "~/data"
# target = "/data"
# permission = "ro"

# Custom Docker image name (default: "llmist-sandbox")
# image-name = "my-custom-llmist"

# Extra arguments to docker run (ports, network, memory, etc.)
# docker-args = ["-p", "3000:3000"]

# Custom Dockerfile (see "Custom Dockerfile" section below)
# dockerfile = """..."""
```

### Per-Profile Docker Settings

Override Docker settings for specific commands or profiles:

```toml
[docker]
enabled = true
cwd-permission = "rw"

# Read-only profile for code review (extra safety)
[profile-readonly]
inherits = "agent"
docker-cwd-permission = "ro"  # Override just for this profile

[code-review]
inherits = "profile-readonly"
# Inherits docker-cwd-permission = "ro"
```

## Custom Dockerfile

Customize the container environment by providing your own Dockerfile. This is useful for installing additional tools.

### Example: Adding GitHub CLI

```toml
[docker]
enabled = true
env-vars = ["GH_TOKEN"]  # Forward token for gh authentication

dockerfile = """
FROM oven/bun:1-debian

RUN apt-get update && apt-get install -y --no-install-recommends \
    ed ripgrep git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install ast-grep
RUN curl -fsSL https://raw.githubusercontent.com/ast-grep/ast-grep/main/install.sh | bash \
    && mv /root/.local/bin/ast-grep /usr/local/bin/ 2>/dev/null || true \
    && mv /root/.local/bin/sg /usr/local/bin/ 2>/dev/null || true

# Install GitHub CLI (gh)
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Install llmist globally
RUN bun add -g llmist

WORKDIR /workspace
ENTRYPOINT ["llmist"]
"""
```

After changing the Dockerfile, the image rebuilds automatically on next run.

### Security Considerations

> **⚠️ Warning:** The default Dockerfile installs ast-grep via `curl | bash`, which
> trusts the remote script. For production use, consider:
> - Pinning a specific ast-grep version
> - Downloading and verifying checksums before execution
> - Using a package manager if available

### Forcing a Rebuild

If you need to force a rebuild (e.g., to get latest llmist version):

```bash
# Clear the image cache
rm ~/.llmist/docker-cache/image-hash.json

# Optionally remove the Docker image too
docker rmi llmist-sandbox
```

## Development Setup

When developing llmist itself, use a custom dockerfile and `docker-args` to mount your local source:

```toml
[docker]
enabled = true
docker-args = ["-v", "/path/to/llmist:/path/to/llmist:ro"]

dockerfile = """
FROM oven/bun:1-debian

# Create mount point for source
RUN mkdir -p /path/to/llmist

# Install tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    ripgrep git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Run llmist from mounted source
ENTRYPOINT ["bun", "run", "/path/to/llmist/src/cli.ts"]
"""
```

This approach:
1. Mounts your source read-only via `docker-args`
2. Uses a custom dockerfile with an entrypoint pointing to mounted source
3. Runs `bun run /path/to/llmist/src/cli.ts` instead of npm-installed binary

## Environment Variables

Forward environment variables into the container:

```toml
[docker]
env-vars = ["GH_TOKEN", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]
```

By default, these API keys are always forwarded:
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GEMINI_API_KEY`

## Extra Docker Arguments

Pass additional arguments directly to `docker run` using `docker-args`. This is useful for:
- Port mapping (`-p`)
- Network modes (`--network`)
- Resource limits (`--memory`, `--cpus`)
- GPU access (`--gpus`)
- Any other Docker option

```toml
[docker]
enabled = true

# Expose ports for dev servers
docker-args = ["-p", "3000:3000", "-p", "8080:8080"]
```

### Common Examples

```toml
# Single port
docker-args = ["-p", "31337:31337"]

# Multiple ports
docker-args = ["-p", "3000:3000", "-p", "5173:5173", "-p", "8080:8080"]

# Host networking (access all host ports)
docker-args = ["--network", "host"]

# GPU access (requires nvidia-docker)
docker-args = ["--gpus", "all"]

# Resource limits
docker-args = ["--memory", "4g", "--cpus", "2"]

# Combined
docker-args = [
  "-p", "3000:3000",
  "--memory", "4g",
]
```

> **Note:** Arguments are passed directly to `docker run`. Refer to
> [Docker run reference](https://docs.docker.com/reference/cli/docker/container/run/) for all options.

### Security Note

The `docker-args` option is only read from your global `~/.llmist/cli.toml` config file. llmist does not support project-level configuration files, which prevents malicious repositories from injecting dangerous Docker arguments like `--privileged` or `-v /:/host`.

## Container Detection

llmist automatically detects when it's already running inside a Docker container to prevent infinite nesting. Detection methods:

1. **`/.dockerenv` file** - Docker creates this in all containers
2. **`/proc/1/cgroup`** - Contains "docker" or "containerd" on Linux

If detected, Docker mode is skipped with a warning:

```
Warning: Docker mode requested but already inside a container. Proceeding without re-containerization.
```

## Mounts

The container uses selective mounting to avoid cross-platform issues with native modules in gadgets:

| Host Path | Container Path | Permission | Notes |
|-----------|---------------|------------|-------|
| Current directory | `/workspace` | `cwd-permission` (default: rw) | Working directory |
| `~/.llmist/cli.toml` | `/root/.llmist/cli.toml` | `config-permission` (default: ro) | Config file |
| `~/.llmist/gadgets/` | `/root/.llmist/gadgets/` | `config-permission` (default: ro) | Local gadgets |
| Named volume | `/root/.llmist/gadget-cache` | rw | Container's own cache |

The **gadget-cache is NOT shared** between host and container. This is intentional—gadgets with native modules (like `sharp`, `tiktoken`, `better-sqlite3`) are compiled for the platform they run on. A macOS host's cache would fail inside a Linux container.

Instead, the container uses a named Docker volume (`llmist-gadget-cache`) that persists across runs but remains isolated from the host's cache.

### Custom Mounts

Add custom mounts:

```toml
[[docker.mounts]]
source = "~/shared-data"
target = "/data"
permission = "ro"

[[docker.mounts]]
source = "/tmp/scratch"
target = "/scratch"
permission = "rw"
```

## Troubleshooting

### Docker not available

```
Error: Docker is required but not available.
```

Install Docker Desktop or Docker Engine and ensure the daemon is running:

```bash
docker info  # Should show Docker version info
```

### Config validation errors inside container

```
Error: /root/.llmist/cli.toml: [docker].enabled is not a valid option
```

This happens when the container runs an older llmist version that doesn't recognize new config options. Solutions:

1. **Enable dev mode** to use your local source
2. **Wait for npm release** with the new features
3. **Use `--no-docker`** temporarily

### Permission denied

```
Error: EACCES: permission denied
```

The CWD is mounted read-only. Either:
- Use `cwd-permission = "rw"` in config
- Use `--docker` instead of `--docker-ro`
- Adjust your agent's workflow to not write files

### gh CLI authentication

```
gh: To authenticate, run: gh auth login
```

Ensure `GH_TOKEN` is set and forwarded:

```bash
# Set token (one-time)
export GH_TOKEN=$(gh auth token)

# Forward it in config
[docker]
env-vars = ["GH_TOKEN"]
```
