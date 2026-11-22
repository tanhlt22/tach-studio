import { Directive, ElementRef, OnDestroy, effect, inject, input, output } from '@angular/core';

@Directive({
  selector: 'dialog[appModalOpen]',
  standalone: true
})
export class AdminDialogDirective implements OnDestroy {
  private el = inject(ElementRef<HTMLDialogElement>);
  appModalOpen = input.required<boolean>();
  closed = output<void>();

  private pointerStartedOutside = false;
  private readonly supportsClosedBy =
    typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;

  private readonly onClose = () => {
    const dialog = this.el.nativeElement;
    dialog.returnValue = '';
    if (this.appModalOpen()) {
      this.closed.emit();
    }
  };

  private readonly onPointerDown = (e: PointerEvent) => {
    this.pointerStartedOutside = this.isOutsideDialog(e, this.el.nativeElement);
  };

  private readonly onPointerUp = (e: PointerEvent) => {
    const dialog = this.el.nativeElement;
    if (this.pointerStartedOutside && this.isOutsideDialog(e, dialog) && dialog.open) {
      dialog.close();
    }
    this.pointerStartedOutside = false;
  };

  constructor() {
    const dialog = this.el.nativeElement;
    dialog.addEventListener('close', this.onClose);

    if (!this.supportsClosedBy) {
      dialog.addEventListener('pointerdown', this.onPointerDown);
      dialog.addEventListener('pointerup', this.onPointerUp);
    }

    effect(() => {
      const shouldOpen = this.appModalOpen();
      if (shouldOpen) {
        if (!dialog.open) {
          dialog.showModal();
        }
      } else if (dialog.open) {
        dialog.close();
      }
    });
  }

  private isOutsideDialog(e: PointerEvent, dialog: HTMLDialogElement): boolean {
    const rect = dialog.getBoundingClientRect();
    return (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    );
  }

  ngOnDestroy(): void {
    const dialog = this.el.nativeElement;
    dialog.removeEventListener('close', this.onClose);
    if (!this.supportsClosedBy) {
      dialog.removeEventListener('pointerdown', this.onPointerDown);
      dialog.removeEventListener('pointerup', this.onPointerUp);
    }
  }
}
