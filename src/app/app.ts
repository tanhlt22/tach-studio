import { Component, signal } from '@angular/core';
import { RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Header } from './layout/header/header';
import { Footer } from './layout/footer/footer';
import { filter } from 'rxjs';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Header, Footer, CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('Tách Tách Photobooth');
  protected showHeader = signal(true);
  protected showFooter = signal(true);

  constructor(private router: Router) {
    const initialPath = typeof window !== 'undefined' ? window.location.pathname : '';
    this.syncShellVisibility(initialPath);

    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd)
    ).subscribe((e) => {
      this.syncShellVisibility(e.urlAfterRedirects || e.url || '');
    });
  }

  private syncShellVisibility(rawUrl: string) {
    const path = rawUrl.split('?')[0];
    const isGalleryPage = path.startsWith('/event/') || path.startsWith('/gallery/');
    const isAdminPage = path === '/admin' || path.startsWith('/admin/');

    // Trang gallery sự kiện: Hiện Header, Ẩn Footer.
    // Trang admin: Ẩn cả Header & Footer marketing để nhường không gian thao tác di động.
    this.showHeader.set(!isAdminPage);
    this.showFooter.set(!isGalleryPage && !isAdminPage);
  }
}
