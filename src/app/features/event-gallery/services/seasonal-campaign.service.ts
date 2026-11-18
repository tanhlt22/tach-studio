import { Injectable } from '@angular/core';

export type SeasonalCampaignId = 'mens-day-2026' | null;

export interface SeasonalCampaignConfig {
  id: Exclude<SeasonalCampaignId, null>;
  title: string;
  subtitle: string;
  dateBadge: string;
  greetingHeading: string;
  greetingWish: string;
  signature: string;
  startDate: string; // YYYY-MM-DD in Asia/Ho_Chi_Minh
  endDate: string;   // YYYY-MM-DD inclusive in Asia/Ho_Chi_Minh
}

const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const MENS_DAY_2026_CONFIG: SeasonalCampaignConfig = {
  id: 'mens-day-2026',
  title: 'Chúc Mừng Ngày Quốc Tế Đàn Ông',
  subtitle: "Happy International Men's Day • 19/11",
  dateBadge: '19 • 11',
  greetingHeading: 'Chúc Mừng Ngày Quốc Tế Đàn Ông 19/11',
  greetingWish:
    'Chúc phái mạnh luôn rạng rỡ, tự tin, bản lĩnh và lưu giữ trọn vẹn những khoảnh khắc tuyệt vời cùng Tách Tách Photobooth!',
  signature: 'Tách Tách Photobooth • Nơi lưu trữ kỉ niệm',
  startDate: '2026-11-18',
  endDate: '2026-11-20'
};

interface TemporalPlainDateLike {
  toString(): string;
}

interface TemporalApiLike {
  Now?: {
    plainDateISO?: (timeZone: string) => TemporalPlainDateLike;
  };
  PlainDate?: {
    from?: (value: string) => TemporalPlainDateLike;
    compare?: (a: TemporalPlainDateLike, b: TemporalPlainDateLike) => number;
  };
}

@Injectable({
  providedIn: 'root'
})
export class SeasonalCampaignService {
  readonly mensDayConfig = MENS_DAY_2026_CONFIG;

  /**
   * Determines whether the International Men's Day (19/11/2026) special
   * single-session 3D greeting card & photo tree experience is active.
   *
   * Evaluates the wall-clock calendar date in Asia/Ho_Chi_Minh (GMT+7) so that
   * once the campaign window ends (2026-11-21 00:00 GMT+7), the gallery
   * automatically reverts to its normal layout.
   */
  isMensDayActive(themeOverride?: string | null): boolean {
    const normalized = themeOverride?.trim().toLowerCase();
    if (normalized === 'normal' || normalized === 'off' || normalized === 'default') {
      return false;
    }
    if (normalized === 'mensday' || normalized === '19-11' || normalized === '1911') {
      return true;
    }
    return this.isWithinDateWindow(MENS_DAY_2026_CONFIG.startDate, MENS_DAY_2026_CONFIG.endDate);
  }

  getActiveCampaign(themeOverride?: string | null): SeasonalCampaignConfig | null {
    return this.isMensDayActive(themeOverride) ? MENS_DAY_2026_CONFIG : null;
  }

  getCurrentVietnamDateIso(): string {
    const temporal = (globalThis as { Temporal?: TemporalApiLike }).Temporal;
    if (typeof temporal?.Now?.plainDateISO === 'function') {
      try {
        return temporal.Now.plainDateISO(VIETNAM_TIME_ZONE).toString();
      } catch {
        // Fall through to Intl ISO calendar format
      }
    }

    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: VIETNAM_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date());
    } catch {
      const now = new Date();
      const vnOffsetMs = 7 * 60 * 60 * 1000;
      return new Date(now.getTime() + vnOffsetMs).toISOString().slice(0, 10);
    }
  }

  private isWithinDateWindow(startIso: string, endIso: string): boolean {
    const temporal = (globalThis as { Temporal?: TemporalApiLike }).Temporal;
    if (
      typeof temporal?.Now?.plainDateISO === 'function' &&
      typeof temporal?.PlainDate?.from === 'function' &&
      typeof temporal?.PlainDate?.compare === 'function'
    ) {
      try {
        const today = temporal.Now.plainDateISO(VIETNAM_TIME_ZONE);
        const start = temporal.PlainDate.from(startIso);
        const end = temporal.PlainDate.from(endIso);
        return (
          temporal.PlainDate.compare(today, start) >= 0 &&
          temporal.PlainDate.compare(today, end) <= 0
        );
      } catch {
        // Fall through to ISO date string comparison
      }
    }

    const todayIso = this.getCurrentVietnamDateIso();
    return todayIso >= startIso && todayIso <= endIso;
  }
}
