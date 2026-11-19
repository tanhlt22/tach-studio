import { Injectable } from '@angular/core';

export type SeasonalCampaignId = 'teachers-day-2026' | null;

export interface SeasonalCampaignConfig {
  id: Exclude<SeasonalCampaignId, null>;
  title: string;
  subtitle: string;
  dateBadge: string;
  salutation: string;
  greetingHeading: string;
  greetingWish: string;
  wishes: readonly string[];
  photoBackNote: string;
  signature: string;
  startDate: string; // YYYY-MM-DD in Asia/Ho_Chi_Minh
  endDate: string;   // YYYY-MM-DD inclusive in Asia/Ho_Chi_Minh
}

const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const TEACHERS_DAY_2026_CONFIG: SeasonalCampaignConfig = {
  id: 'teachers-day-2026',
  title: 'Tri Ân Ngày Nhà Giáo Việt Nam',
  subtitle: "Happy Vietnamese Teachers' Day • 20/11",
  dateBadge: '20 • 11',
  salutation: 'Kính gửi Người Lái Đò Thầm Lặng,',
  greetingHeading: 'Chúc Mừng Ngày Nhà Giáo Việt Nam 20/11',
  greetingWish:
    'Kính chúc Thầy Cô luôn dồi dào sức khỏe, giữ mãi ngọn lửa nhiệt huyết trên bục giảng và ngập tràn niềm vui bên những thế hệ học trò thân thương.',
  wishes: [
    'Kính chúc Thầy Cô luôn dồi dào sức khỏe, giữ mãi ngọn lửa nhiệt huyết trên bục giảng và ngập tràn niềm vui bên những thế hệ học trò thân thương.',
    'Cảm ơn Thầy Cô đã kiên nhẫn dìu dắt, gieo từng hạt mầm tri thức và nâng bước chúng em chạm tới những ước mơ tươi đẹp nhất.',
    'Nhân ngày 20/11, xin gửi tới Thầy Cô ngàn lời tri ân sâu sắc. Mong mỗi trang giáo án luôn ngập nắng ấm và mỗi nụ cười hôm nay sẽ mãi vẹn nguyên trong khung hình kỷ niệm.',
    'Dẫu mai này đi khắp muôn phương, lời dạy ân cần của Thầy Cô vẫn luôn là ánh sáng soi đường. Chúc Thầy Cô một mùa hiến chương thật bình an và rạng rỡ!'
  ],
  photoBackNote: 'Lưu giữ nụ cười rạng rỡ và những khoảnh khắc tri ân ấm áp ngày 20/11 cùng Thầy Cô & bạn bè.',
  signature: 'Tách Tách Photobooth • Nơi lưu trữ kỉ niệm',
  startDate: '2026-11-20',
  endDate: '2026-11-22'
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
  readonly teachersDayConfig = TEACHERS_DAY_2026_CONFIG;

  /**
   * Determines whether the Vietnamese Teachers' Day (20/11/2026) special
   * fullscreen keepsake envelope & tribute letter experience is active.
   *
   * Evaluates the calendar date in Asia/Ho_Chi_Minh (GMT+7) so that once the
   * campaign window ends (2026-11-23 00:00 GMT+7), the gallery automatically
   * reverts to its normal layout.
   */
  isTeachersDayActive(themeOverride?: string | null): boolean {
    const normalized = themeOverride?.trim().toLowerCase();
    if (normalized === 'normal' || normalized === 'off' || normalized === 'default') {
      return false;
    }
    if (
      normalized === 'teachersday' ||
      normalized === 'teachers-day' ||
      normalized === '20-11' ||
      normalized === '2011'
    ) {
      return true;
    }
    return this.isWithinDateWindow(TEACHERS_DAY_2026_CONFIG.startDate, TEACHERS_DAY_2026_CONFIG.endDate);
  }

  getActiveCampaign(themeOverride?: string | null): SeasonalCampaignConfig | null {
    return this.isTeachersDayActive(themeOverride) ? TEACHERS_DAY_2026_CONFIG : null;
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
