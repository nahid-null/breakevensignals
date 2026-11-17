import { getRequest } from '@tanstack/react-start/server';
import { simulatorControlsAllowed } from './simulator-control-policy';

export function requireSimulatorControlAccess() {
  if (!simulatorControlsAllowed(getRequest().url)) {
    throw new Error('Balance controls are locked on hosted sites until Invite-only access is verified.');
  }
}