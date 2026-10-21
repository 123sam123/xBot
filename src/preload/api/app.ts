import type { AppApi } from '../../shared/contracts/app';
import { appChannels } from '../../shared/contracts/app.channels';
import { invoke } from '../invoke';

export const app: AppApi = {
  getInfo: () => invoke(appChannels.getInfo),
  getStatus: () => invoke(appChannels.getStatus),
};
