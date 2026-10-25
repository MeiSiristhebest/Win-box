// src/engine/ports.ts
// 宿主能力接口：引擎层从这里取依赖，禁止 import electron。
// T04 由主进程注入实现；T02 单测注入内存桩。
import type { JsSpiderHostPort } from './spider/SpiderPorts';

export type {
  HttpClient,
  HttpRequest,
  HttpResponse,
  KVStore,
  Logger,
} from '../shared/types';

/** Full capability set assembled by the main process for spider factories and JS sandboxes. */
export interface EngineHost extends JsSpiderHostPort {}
