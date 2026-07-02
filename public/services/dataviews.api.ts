import type { DataViewsResponse } from '../../common/types';
import { PLUGIN_ROUTE_PREFIX } from '../../common';
import { ApiClient } from './api.client';

/** Typed client for the data-views endpoint. */
export class DataViewsApiService extends ApiClient {
  public async getDataViews(): Promise<DataViewsResponse> {
    return this.get<DataViewsResponse>(`${PLUGIN_ROUTE_PREFIX}/data-views`);
  }
}
