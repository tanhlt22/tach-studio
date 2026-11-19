import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  input,
  output,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { GalleryPhoto } from '../../services/google-drive-gallery.service';
import { SeasonalCampaignConfig } from '../../services/seasonal-campaign.service';

export type EnvelopeOpeningPhase = 'sealed' | 'unsealing' | 'rising' | 'fading' | 'done';

interface TributePetal {
  id: number;
  leftPct: number;
  delayMs: number;
  durationMs: number;
  driftPx: number;
  sizePx: number;
  tone: 'gold' | 'rose' | 'burgundy' | 'cream';
}

@Component({
  selector: 'app-teachers-day-letter',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './teachers-day-letter.html',
  styleUrl: './teachers-day-letter.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TeachersDayLetter implements OnInit, OnDestroy {
  campaign = input.required<SeasonalCampaignConfig>();
  photos = input<GalleryPhoto[]>([]);
  selectedIndex = input<number>(0);
  isPolling = input<boolean>(false);
  replayTrigger = input<number>(0);
  getPhotoSrc = input.required<(photo: GalleryPhoto) => string>();
  getThumbSrc = input.required<(photo: GalleryPhoto) => string>();
  getVideoSrc = input.required<(photo: GalleryPhoto) => string>();
  isVideoMedia = input.required<(photo: GalleryPhoto | null | undefined) => boolean>();

  indexChange = output<number>();
  photoZoom = output<number>();
  downloadCurrent = output<GalleryPhoto>();

  // ===== FULLSCREEN AUTO-OPENING ENVELOPE STATE =====
  envelopePhase = signal<EnvelopeOpeningPhase>('sealed');
  isOverlayVisible = computed(() => this.envelopePhase() !== 'done');
  envelopePreviewPhoto = computed<GalleryPhoto | null>(() => {
    const list = this.photos();
    if (list.length === 0) return null;
    const isVid = this.isVideoMedia();
    return list.find(p => !isVid(p)) ?? list[0] ?? null;
  });

  // ===== INTERACTIVE LETTER & POLAROID DECK STATE =====
  wishIndex = signal<number>(0);
  wishTransitionKey = signal<number>(0);
  isPhotoFlipped = signal<boolean>(false);
  tributeCount = signal<number>(0);
  showPetalBurst = signal<boolean>(false);
  petalBurstKey = signal<number>(0);
  photoTransitionDir = signal<'next' | 'prev' | null>(null);

  readonly petals: readonly TributePetal[] = [
    { id: 1, leftPct: 8, delayMs: 0, durationMs: 2450, driftPx: 26, sizePx: 14, tone: 'gold' },
    { id: 2, leftPct: 16, delayMs: 140, durationMs: 2650, driftPx: -22, sizePx: 12, tone: 'rose' },
    { id: 3, leftPct: 24, delayMs: 260, durationMs: 2350, driftPx: 30, sizePx: 15, tone: 'burgundy' },
    { id: 4, leftPct: 33, delayMs: 80, durationMs: 2700, driftPx: -18, sizePx: 11, tone: 'gold' },
    { id: 5, leftPct: 42, delayMs: 210, durationMs: 2500, driftPx: 22, sizePx: 14, tone: 'cream' },
    { id: 6, leftPct: 50, delayMs: 40, durationMs: 2600, driftPx: -28, sizePx: 13, tone: 'rose' },
    { id: 7, leftPct: 59, delayMs: 190, durationMs: 2400, driftPx: 24, sizePx: 15, tone: 'gold' },
    { id: 8, leftPct: 68, delayMs: 310, durationMs: 2550, driftPx: -20, sizePx: 12, tone: 'burgundy' },
    { id: 9, leftPct: 76, delayMs: 110, durationMs: 2680, driftPx: 18, sizePx: 14, tone: 'rose' },
    { id: 10, leftPct: 84, delayMs: 240, durationMs: 2380, driftPx: -26, sizePx: 13, tone: 'gold' },
    { id: 11, leftPct: 91, delayMs: 160, durationMs: 2520, driftPx: -16, sizePx: 12, tone: 'cream' },
    { id: 12, leftPct: 29, delayMs: 380, durationMs: 2300, driftPx: 20, sizePx: 11, tone: 'rose' },
    { id: 13, leftPct: 63, delayMs: 340, durationMs: 2420, driftPx: -24, sizePx: 13, tone: 'gold' },
    { id: 14, leftPct: 47, delayMs: 420, durationMs: 2280, driftPx: 16, sizePx: 12, tone: 'burgundy' }
  ];

  // ===== COMPUTED MEDIA SLOTS =====
  safeIndex = computed(() => {
    const total = this.photos().length;
    if (total === 0) return 0;
    const raw = this.selectedIndex();
    return ((raw % total) + total) % total;
  });

  currentPhoto = computed<GalleryPhoto | null>(() => {
    const list = this.photos();
    if (list.length === 0) return null;
    return list[this.safeIndex()] ?? list[0] ?? null;
  });

  prevPhoto = computed<GalleryPhoto | null>(() => {
    const list = this.photos();
    if (list.length < 2) return null;
    const prevIdx = (this.safeIndex() - 1 + list.length) % list.length;
    return list[prevIdx] ?? null;
  });

  nextPhoto = computed<GalleryPhoto | null>(() => {
    const list = this.photos();
    if (list.length < 2) return null;
    const nextIdx = (this.safeIndex() + 1) % list.length;
    if (list.length === 2 && nextIdx === (this.safeIndex() - 1 + list.length) % list.length) {
      return null;
    }
    return list[nextIdx] ?? null;
  });

  currentWish = computed<string>(() => {
    const cfg = this.campaign();
    const list = cfg.wishes && cfg.wishes.length > 0 ? cfg.wishes : [cfg.greetingWish];
    return list[this.wishIndex() % list.length];
  });

  totalWishes = computed<number>(() => {
    const cfg = this.campaign();
    return cfg.wishes && cfg.wishes.length > 0 ? cfg.wishes.length : 1;
  });

  // ===== PRIVATE TIMERS & TOUCH TRACKING =====
  private sequenceTimers: ReturnType<typeof setTimeout>[] = [];
  private petalTimer: ReturnType<typeof setTimeout> | null = null;
  private dirTimer: ReturnType<typeof setTimeout> | null = null;
  private lastReplayTrigger = 0;
  private swipeStartX = 0;
  private swipeStartY = 0;
  private isSwipingDeck = false;

  constructor() {
    // Re-trigger fullscreen auto-opening sequence whenever parent increments replayTrigger
    effect(() => {
      const trigger = this.replayTrigger();
      if (trigger > 0 && trigger !== this.lastReplayTrigger) {
        this.lastReplayTrigger = trigger;
        this.startEnvelopeSequence();
      }
    });

    // Reset flip state when active photo changes
    effect(() => {
      this.safeIndex();
      this.isPhotoFlipped.set(false);
    });
  }

  ngOnInit(): void {
    this.startEnvelopeSequence();
  }

  ngOnDestroy(): void {
    this.clearSequenceTimers();
    if (this.petalTimer) {
      clearTimeout(this.petalTimer);
      this.petalTimer = null;
    }
    if (this.dirTimer) {
      clearTimeout(this.dirTimer);
      this.dirTimer = null;
    }
    this.unlockBodyScroll();
  }

  // ===== ENVELOPE AUTO-OPENING CHOREOGRAPHY =====

  startEnvelopeSequence(): void {
    this.clearSequenceTimers();
    this.lockBodyScroll();
    this.envelopePhase.set('sealed');

    const prefersReduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const tUnseal = prefersReduced ? 350 : 650;
    const tRise = prefersReduced ? 1050 : 1550;
    const tFade = prefersReduced ? 1850 : 2700;
    const tDone = prefersReduced ? 2250 : 3250;

    this.sequenceTimers.push(
      setTimeout(() => this.envelopePhase.set('unsealing'), tUnseal),
      setTimeout(() => this.envelopePhase.set('rising'), tRise),
      setTimeout(() => this.envelopePhase.set('fading'), tFade),
      setTimeout(() => {
        this.envelopePhase.set('done');
        this.unlockBodyScroll();
      }, tDone)
    );
  }

  nudgeOpenEnvelope(): void {
    if (this.envelopePhase() === 'sealed') {
      this.clearSequenceTimers();
      this.envelopePhase.set('unsealing');
      this.sequenceTimers.push(
        setTimeout(() => this.envelopePhase.set('rising'), 700),
        setTimeout(() => this.envelopePhase.set('fading'), 1750),
        setTimeout(() => {
          this.envelopePhase.set('done');
          this.unlockBodyScroll();
        }, 2300)
      );
    }
  }

  skipOpening(event?: Event): void {
    event?.stopPropagation();
    this.clearSequenceTimers();
    this.envelopePhase.set('fading');
    this.sequenceTimers.push(
      setTimeout(() => {
        this.envelopePhase.set('done');
        this.unlockBodyScroll();
      }, 320)
    );
  }

  replayOpening(): void {
    this.startEnvelopeSequence();
  }

  // ===== INTERACTIVE LETTER ACTIONS =====

  cycleWish(): void {
    const count = this.totalWishes();
    if (count <= 1) return;
    this.wishIndex.update(i => (i + 1) % count);
    this.wishTransitionKey.update(k => k + 1);
  }

  sendTributeFlowers(): void {
    this.tributeCount.update(c => c + 1);
    this.petalBurstKey.update(k => k + 1);
    this.showPetalBurst.set(true);

    if (this.petalTimer) {
      clearTimeout(this.petalTimer);
    }
    this.petalTimer = setTimeout(() => {
      this.showPetalBurst.set(false);
      this.petalTimer = null;
    }, 3000);
  }

  // ===== POLAROID DECK NAVIGATION & 3D FLIP =====

  showPrevPhoto(event?: Event): void {
    event?.stopPropagation();
    const total = this.photos().length;
    if (total <= 1) return;
    this.triggerDeckAnimation('prev');
    const nextIdx = (this.safeIndex() - 1 + total) % total;
    this.indexChange.emit(nextIdx);
  }

  showNextPhoto(event?: Event): void {
    event?.stopPropagation();
    const total = this.photos().length;
    if (total <= 1) return;
    this.triggerDeckAnimation('next');
    const nextIdx = (this.safeIndex() + 1) % total;
    this.indexChange.emit(nextIdx);
  }

  selectPhotoFromLetter(index: number): void {
    const total = this.photos().length;
    if (index < 0 || index >= total) return;
    if (index === this.safeIndex()) {
      this.openCurrentZoom();
      return;
    }
    this.triggerDeckAnimation(index > this.safeIndex() ? 'next' : 'prev');
    this.indexChange.emit(index);
  }

  toggleFlipPhoto(event?: Event): void {
    event?.stopPropagation();
    this.isPhotoFlipped.update(v => !v);
  }

  openCurrentZoom(event?: Event): void {
    event?.stopPropagation();
    if (this.photos().length === 0) return;
    this.photoZoom.emit(this.safeIndex());
  }

  requestDownloadCurrent(event?: Event): void {
    event?.stopPropagation();
    const photo = this.currentPhoto();
    if (photo) {
      this.downloadCurrent.emit(photo);
    }
  }

  onDeckTouchStart(event: TouchEvent): void {
    if (event.touches.length !== 1 || this.photos().length <= 1) return;
    this.swipeStartX = event.touches[0].clientX;
    this.swipeStartY = event.touches[0].clientY;
    this.isSwipingDeck = true;
  }

  onDeckTouchEnd(event: TouchEvent): void {
    if (!this.isSwipingDeck || event.changedTouches.length === 0) return;
    this.isSwipingDeck = false;
    const dx = event.changedTouches[0].clientX - this.swipeStartX;
    const dy = event.changedTouches[0].clientY - this.swipeStartY;
    if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.25) {
      if (dx < 0) {
        this.showNextPhoto();
      } else {
        this.showPrevPhoto();
      }
    }
  }

  getPhotoLabel(photo: GalleryPhoto | null, index: number): string {
    if (!photo) return 'Kỷ niệm 20/11';
    if (this.isVideoMedia()(photo)) return 'Video hậu trường • 20/11';
    if (photo.role === 'final') return 'Dải ảnh in kỷ niệm 20/11';
    if (photo.role === 'shot') return `Khoảnh khắc tri ân #${photo.slotIndex || index}`;
    return photo.name || `Khoảnh khắc #${index + 1}`;
  }

  private triggerDeckAnimation(dir: 'next' | 'prev'): void {
    this.photoTransitionDir.set(dir);
    if (this.dirTimer) {
      clearTimeout(this.dirTimer);
    }
    this.dirTimer = setTimeout(() => {
      this.photoTransitionDir.set(null);
      this.dirTimer = null;
    }, 340);
  }

  private clearSequenceTimers(): void {
    for (const timer of this.sequenceTimers) {
      clearTimeout(timer);
    }
    this.sequenceTimers = [];
  }

  private lockBodyScroll(): void {
    if (typeof document !== 'undefined') {
      document.body.style.overflow = 'hidden';
    }
  }

  private unlockBodyScroll(): void {
    if (typeof document !== 'undefined') {
      document.body.style.overflow = '';
    }
  }
}
