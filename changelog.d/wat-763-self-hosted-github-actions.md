Route all six GitHub Actions jobs to their designated self-hosted x64 pools,
establish Node 22 and npm 10.9.2 in each job, and use the prepared release
environment for both Release jobs. Events, conditions and release operations
retain their existing behavior. Release and Claude execution remain unproven;
the existing missing Claude OAuth credential and owner-managed secret cleanup
remain separate follow-up actions.
