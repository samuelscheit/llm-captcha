/**
 * Built-in adapters, one file per provider. User adapters (settings) use the same format and are
 * checked first. Order matters only between adapters that could match the same element: the
 * catch-all text captcha comes last.
 */
import type { AdapterSpec } from "../types";
import { ALIYUN } from "./aliyun";
import { ARKOSE } from "./arkose";
import { AWS } from "./aws";
import { CHINA } from "./china";
import { CLOUDFLARE } from "./cloudflare";
import { DATADOME } from "./datadome";
import { DOGWAF } from "./dogwaf";
import { GEETEST } from "./geetest";
import { GENERIC } from "./generic";
import { GOOGLE } from "./google";
import { HCAPTCHA } from "./hcaptcha";
import { HUMAN } from "./human";
import { MTCAPTCHA } from "./mtcaptcha";
import { POW } from "./pow";
import { TENCENT } from "./tencent";
import { YANDEX } from "./yandex";

export const BUILTIN_ADAPTERS: AdapterSpec[] = [
  ...GOOGLE,
  ...HCAPTCHA,
  ...CLOUDFLARE,
  ...TENCENT,
  ...ALIYUN,
  ...CHINA,
  ...GEETEST,
  ...DATADOME,
  ...ARKOSE,
  ...AWS,
  ...YANDEX,
  ...MTCAPTCHA,
  ...HUMAN,
  ...POW,
  ...DOGWAF,
  ...GENERIC,
];
