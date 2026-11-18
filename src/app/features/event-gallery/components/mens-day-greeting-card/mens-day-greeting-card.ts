import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnDestroy,
  Output,
  ViewChild,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { SeasonalCampaignConfig } from '../../services/seasonal-campaign.service';

interface FireworkParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

@Component({
  selector: 'app-mens-day-greeting-card',
  imports: [CommonModule],
  templateUrl: './mens-day-greeting-card.html',
  styleUrl: './mens-day-greeting-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MensDayGreetingCard implements AfterViewInit, OnDestroy {
  @ViewChild('fireworksCanvas', { static: true }) fireworksCanvas!: ElementRef<HTMLCanvasElement>;

  @Input({ required: true }) campaign!: SeasonalCampaignConfig;
  @Input() photoCount = 0;
  @Input() isPolling = false;
  @Input() previewPhotoUrl: string | null = null;

  @Output() enterTree = new EventEmitter<void>();

  isOpened = signal(false);
  isDismissing = signal(false);

  private timers: ReturnType<typeof setTimeout>[] = [];
  private rafId: number | null = null;
  private particles: FireworkParticle[] = [];
  private destroyed = false;
  private prefersReducedMotion = false;

  private readonly palette = ['#329DD2', '#64B9E6', '#EB2F33', '#F8FAFC', '#FBBF24'];

  constructor(private ngZone: NgZone) {}

  ngAfterViewInit(): void {
    this.prefersReducedMotion =
      typeof window !== 'undefined' &&
      Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

    // 1. Automatically & slowly open the 3D greeting card without requiring clicks
    const openDelayMs = 380;
    const dismissDelayMs = 4200;

    this.timers.push(
      setTimeout(() => {
        if (!this.destroyed) {
          this.isOpened.set(true);
        }
      }, openDelayMs)
    );

    this.timers.push(
      setTimeout(() => {
        if (!this.destroyed) {
          this.dismissSmoothly();
        }
      }, dismissDelayMs)
    );

    this.startFireworks();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.timers.forEach(t => clearTimeout(t));
    this.timers = [];
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  dismissSmoothly(): void {
    if (this.isDismissing()) return;
    this.isDismissing.set(true);

    const exitDuration = this.prefersReducedMotion ? 150 : 480;
    this.timers.push(
      setTimeout(() => {
        if (!this.destroyed) {
          this.enterTree.emit();
        }
      }, exitDuration)
    );
  }

  private startFireworks(): void {
    const canvas = this.fireworksCanvas?.nativeElement;
    if (!canvas) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const burst = (nx: number, ny: number, count: number) => {
      if (this.destroyed) return;
      const cx = nx * window.innerWidth;
      const cy = ny * window.innerHeight;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
        const speed = 1.8 + Math.random() * 4.4;
        this.particles.push({
          x: cx,
          y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.6,
          life: 0,
          maxLife: 46 + Math.random() * 28,
          color: this.palette[Math.floor(Math.random() * this.palette.length)],
          size: 2.2 + Math.random() * 2.4
        });
      }
    };

    // Scheduled celebratory bursts (calmer under reduced-motion preference)
    this.timers.push(setTimeout(() => burst(0.24, 0.28, this.prefersReducedMotion ? 18 : 34), 320));
    this.timers.push(setTimeout(() => burst(0.76, 0.24, this.prefersReducedMotion ? 18 : 34), 820));
    if (!this.prefersReducedMotion) {
      this.timers.push(setTimeout(() => burst(0.5, 0.18, 40), 1350));
      this.timers.push(setTimeout(() => burst(0.2, 0.48, 28), 2100));
      this.timers.push(setTimeout(() => burst(0.8, 0.45, 28), 2550));
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    this.ngZone.runOutsideAngular(() => {
      const tick = () => {
        if (this.destroyed) return;
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

        for (let i = this.particles.length - 1; i >= 0; i--) {
          const p = this.particles[i];
          p.life += 1;
          if (p.life >= p.maxLife) {
            this.particles.splice(i, 1);
            continue;
          }
          p.vx *= 0.965;
          p.vy = p.vy * 0.965 + 0.065;
          p.x += p.vx;
          p.y += p.vy;

          const alpha = Math.max(0, 1 - p.life / p.maxLife);
          ctx.globalAlpha = alpha;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.55 + alpha * 0.45), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;

        this.rafId = requestAnimationFrame(tick);
      };
      this.rafId = requestAnimationFrame(tick);
    });
  }
}
