import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type * as ThreeTypes from 'three';
import type { Tree as EzTreeType } from '@dgreenheck/ez-tree';
import { GalleryPhoto } from '../../services/google-drive-gallery.service';

export interface TreeFocusRequest {
  index: number;
  seq: number;
}

interface PhotoNodeRecord {
  index: number;
  photo: GalleryPhoto;
  anchorGroup: ThreeTypes.Group;
  swayPivot: ThreeTypes.Group;
  cardGroup: ThreeTypes.Group;
  backingMesh: ThreeTypes.Mesh;
  frontMesh: ThreeTypes.Mesh;
  backMesh: ThreeTypes.Mesh;
  hitMeshes: ThreeTypes.Object3D[];
  angle: number;
  baseScale: number;
  texture?: ThreeTypes.Texture;
}

type ThreeModule = typeof ThreeTypes;

@Component({
  selector: 'app-mens-day-photo-tree',
  imports: [CommonModule],
  templateUrl: './mens-day-photo-tree.html',
  styleUrl: './mens-day-photo-tree.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MensDayPhotoTree implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('stageContainer', { static: true }) stageContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('canvasHost', { static: true }) canvasHost!: ElementRef<HTMLDivElement>;

  @Input() photos: GalleryPhoto[] = [];
  @Input() paused = false;
  @Input() focusRequest: TreeFocusRequest | null = null;
  @Input() getPhotoPreviewUrl!: (photo: GalleryPhoto) => string;
  @Input() isVideoMedia!: (photo: GalleryPhoto | null | undefined) => boolean;

  @Output() photoSelected = new EventEmitter<number>();
  @Output() frontIndexChange = new EventEmitter<number>();

  isSceneReady = signal(false);
  webglUnavailable = signal(false);
  isAutoRotating = signal(true);
  isDragging = signal(false);
  hoveredPhotoIndex = signal<number | null>(null);
  frontPhotoIndex = signal(0);

  private THREE: ThreeModule | null = null;
  private renderer: ThreeTypes.WebGLRenderer | null = null;
  private scene: ThreeTypes.Scene | null = null;
  private camera: ThreeTypes.PerspectiveCamera | null = null;
  private treeGroup: ThreeTypes.Group | null = null;
  private ezTree: EzTreeType | null = null;
  private photoGroup: ThreeTypes.Group | null = null;
  private dustPoints: ThreeTypes.Points | null = null;
  private miniBalloons: { group: ThreeTypes.Group; baseY: number; phase: number }[] = [];
  private skyBalloons: { group: ThreeTypes.Group; baseX: number; baseZ: number; speed: number; phase: number }[] = [];
  private photoNodes: PhotoNodeRecord[] = [];
  private canopySamples: ThreeTypes.Vector3[] = [];
  private canopyMaxRadius = 1.65;

  private sharedBackTexture: ThreeTypes.Texture | null = null;
  private sharedSparkleTexture: ThreeTypes.Texture | null = null;
  private sharedPlaqueTexture: ThreeTypes.Texture | null = null;
  private sharedShadowTexture: ThreeTypes.Texture | null = null;
  private disposableGeometries: ThreeTypes.BufferGeometry[] = [];
  private disposableMaterials: ThreeTypes.Material[] = [];
  private photoBranchGeometries: ThreeTypes.BufferGeometry[] = [];
  private photoBranchMaterials: ThreeTypes.Material[] = [];

  private rafId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private destroyed = false;
  private isOffScreen = false;
  private isTabHidden = false;
  private prefersReducedMotion = false;
  private motionMediaQuery: MediaQueryList | null = null;

  // Rotation & interaction physics
  private currentRotationY = 0;
  private targetRotationY: number | null = null;
  private velocityY = 0;
  private holdSpinDir = 0; // -1 left, +1 right, 0 none
  private holdPressTimer: ReturnType<typeof setTimeout> | null = null;
  private holdDidRepeat = false;

  private cameraPitch = 0.08;
  private targetCameraPitch = 0.08;
  private lastClockTime = 0;
  private elapsedTime = 0;

  // Pointer drag state
  private activePointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private pointerTravel = 0;
  private lastPointerTime = 0;

  private lastPhotosSignature = '';
  private lastEmittedFrontIndex = -1;

  private readonly visibilityHandler = () => {
    this.isTabHidden = typeof document !== 'undefined' && document.hidden;
    this.syncAnimationLoop();
  };

  private readonly contentVisibilityHandler = (event: Event) => {
    const skipped = Boolean((event as Event & { skipped?: boolean }).skipped);
    this.isOffScreen = skipped;
    this.syncAnimationLoop();
  };

  private readonly motionPreferenceHandler = (event: MediaQueryListEvent) => {
    this.prefersReducedMotion = event.matches;
  };

  constructor(private ngZone: NgZone) {}

  ngAfterViewInit(): void {
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.motionMediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.prefersReducedMotion = this.motionMediaQuery.matches;
      this.motionMediaQuery.addEventListener?.('change', this.motionPreferenceHandler);
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    this.setupOffscreenPause();
    void this.initScene();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['photos'] && this.THREE && this.scene) {
      const sig = this.computePhotosSignature(this.photos);
      if (sig !== this.lastPhotosSignature) {
        this.rebuildPhotoOrnaments();
      }
    }

    if (changes['focusRequest'] && this.focusRequest) {
      this.rotateToPhoto(this.focusRequest.index);
    }

    if (changes['paused']) {
      this.syncAnimationLoop();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopAnimationLoop();
    this.clearHoldTimers();

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }

    const stageEl = this.stageContainer?.nativeElement;
    if (stageEl) {
      stageEl.removeEventListener('contentvisibilityautostatechange', this.contentVisibilityHandler);
    }

    this.motionMediaQuery?.removeEventListener?.('change', this.motionPreferenceHandler);
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();

    this.disposePhotoNodes();
    this.disposeEzTreeResources();
    this.sharedBackTexture?.dispose();
    this.sharedSparkleTexture?.dispose();
    this.sharedPlaqueTexture?.dispose();
    this.sharedShadowTexture?.dispose();
    this.disposableGeometries.forEach(g => g.dispose());
    this.disposableMaterials.forEach(m => m.dispose());
    this.disposableGeometries = [];
    this.disposableMaterials = [];

    if (this.renderer) {
      this.renderer.dispose();
      const canvas = this.renderer.domElement;
      if (canvas?.parentElement) {
        canvas.parentElement.removeChild(canvas);
      }
      this.renderer = null;
    }
  }

  // ===== PUBLIC / TEMPLATE INTERACTIONS =====

  toggleAutoRotate(): void {
    this.targetRotationY = null;
    this.isAutoRotating.update(v => !v);
    this.syncAnimationLoop();
    this.renderSingleFrame();
  }

  onSpinButtonDown(direction: -1 | 1, event: PointerEvent): void {
    event.preventDefault();
    this.clearHoldTimers();
    this.holdDidRepeat = false;
    this.targetRotationY = null;

    this.holdPressTimer = setTimeout(() => {
      this.holdDidRepeat = true;
      this.holdSpinDir = direction;
      this.syncAnimationLoop();
    }, 220);
  }

  onSpinButtonUp(direction: -1 | 1): void {
    const wasHolding = this.holdDidRepeat;
    this.clearHoldTimers();
    this.holdSpinDir = 0;

    if (!wasHolding) {
      this.stepPhotoByDirection(direction);
    }
  }

  onSpinButtonCancel(): void {
    this.clearHoldTimers();
    this.holdSpinDir = 0;
  }

  onSpinButtonKeyClick(direction: -1 | 1, event: MouseEvent): void {
    if (event.detail === 0) {
      this.stepPhotoByDirection(direction);
    }
  }

  openFrontPhoto(): void {
    if (this.photos.length === 0) return;
    const idx = Math.min(Math.max(this.frontPhotoIndex(), 0), this.photos.length - 1);
    this.photoSelected.emit(idx);
  }

  getPhotoLabel(photo: GalleryPhoto | undefined, index: number): string {
    if (!photo) return `Ảnh #${index + 1}`;
    if (this.isVideoMedia?.(photo)) return 'Video hậu trường (BTS)';
    if (photo.role === 'final') return 'Ảnh in hoàn thiện';
    if (photo.role === 'shot') return `Ảnh chụp #${photo.slotIndex || index + 1}`;
    return photo.name || `Ảnh #${index + 1}`;
  }

  rotateToPhoto(index: number): void {
    if (this.photoNodes.length === 0) return;
    const node = this.photoNodes.find(n => n.index === index);
    if (!node) return;

    const desiredRot = -node.angle;
    const delta = this.wrapAngle(desiredRot - this.currentRotationY);
    this.targetRotationY = this.currentRotationY + delta;
    this.velocityY = 0;
    this.syncAnimationLoop();
    this.renderSingleFrame();
  }

  // ===== CANVAS POINTER GESTURES =====

  onCanvasPointerDown(event: PointerEvent): void {
    if (!this.renderer || event.button > 0) return;
    const canvas = this.renderer.domElement;
    this.activePointerId = event.pointerId;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.pointerTravel = 0;
    this.lastPointerTime = performance.now();
    this.targetRotationY = null;
    this.velocityY = 0;
    this.isDragging.set(true);

    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Ignore if pointer capture is unsupported
    }
  }

  onCanvasPointerMove(event: PointerEvent): void {
    if (this.activePointerId === event.pointerId) {
      const dx = event.clientX - this.lastPointerX;
      const dy = event.clientY - this.lastPointerY;
      const now = performance.now();
      const dt = Math.max(now - this.lastPointerTime, 8);

      this.pointerTravel += Math.hypot(dx, dy);
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      this.lastPointerTime = now;

      const rotDelta = dx * 0.0085;
      this.currentRotationY += rotDelta;
      this.velocityY = (rotDelta / dt) * 16.67;

      this.targetCameraPitch = Math.min(Math.max(this.targetCameraPitch + dy * 0.0025, -0.14), 0.34);

      this.updateTreeTransforms();
      this.renderSingleFrame();
      return;
    }

    if (event.pointerType === 'mouse' && this.activePointerId === null) {
      const hitIndex = this.raycastPhotoIndex(event.clientX, event.clientY);
      if (this.hoveredPhotoIndex() !== hitIndex) {
        this.hoveredPhotoIndex.set(hitIndex);
      }
    }
  }

  onCanvasPointerUp(event: PointerEvent): void {
    if (this.activePointerId !== event.pointerId) return;

    const canvas = this.renderer?.domElement;
    try {
      if (canvas?.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Ignore
    }

    const totalTravel = this.pointerTravel;
    this.activePointerId = null;
    this.isDragging.set(false);

    if (totalTravel < 10) {
      this.velocityY = 0;
      const tappedIndex = this.raycastPhotoIndex(event.clientX, event.clientY);
      if (tappedIndex !== null) {
        this.ngZone.run(() => {
          this.photoSelected.emit(tappedIndex);
        });
      }
    } else {
      this.syncAnimationLoop();
    }
  }

  onCanvasPointerLeave(): void {
    if (this.hoveredPhotoIndex() !== null) {
      this.hoveredPhotoIndex.set(null);
    }
  }

  // ===== INITIALIZATION & REALISTIC 3D SCENE =====

  private async initScene(): Promise<void> {
    try {
      const [THREE, ezTreeMod] = await Promise.all([
        import('three'),
        import('@dgreenheck/ez-tree')
      ]);
      if (this.destroyed) return;
      this.THREE = THREE;

      const host = this.canvasHost.nativeElement;
      const width = Math.max(host.clientWidth, 280);
      const height = Math.max(host.clientHeight, 320);

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
      renderer.domElement.className = 'tree-webgl-canvas';
      renderer.domElement.setAttribute('aria-hidden', 'true');
      host.appendChild(renderer.domElement);
      this.renderer = renderer;

      const scene = new THREE.Scene();
      this.scene = scene;

      const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 80);
      this.camera = camera;
      this.updateCameraLayout(width, height);

      this.setupLights(THREE, scene);
      this.buildRealisticTreeStage(THREE, ezTreeMod.Tree, scene);
      this.buildFestiveParticles(THREE, scene);
      this.rebuildPhotoOrnaments();

      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(entries => {
          for (const entry of entries) {
            const w = Math.max(entry.contentRect.width, 280);
            const h = Math.max(entry.contentRect.height, 320);
            this.handleResize(w, h);
          }
        });
        this.resizeObserver.observe(host);
      }

      this.isSceneReady.set(true);
      this.renderSingleFrame();
      this.syncAnimationLoop();
    } catch (err) {
      console.warn('[MensDayPhotoTree] 3D tree initialization failed, activating fallback view:', err);
      this.webglUnavailable.set(true);
    }
  }

  private setupLights(THREE: ThreeModule, scene: ThreeTypes.Scene): void {
    // Crisp daylight illumination so realistic bark & green leaves look vibrant on #F8FAFC
    const hemi = new THREE.HemisphereLight(0xf8fafc, 0x7c8b6f, 1.55);
    scene.add(hemi);

    const sunLight = new THREE.DirectionalLight(0xfffaf0, 2.15);
    sunLight.position.set(5.2, 7.8, 6.4);
    scene.add(sunLight);

    const skyFill = new THREE.DirectionalLight(0x9ed6f5, 0.95);
    skyFill.position.set(-5.5, 3.2, 4.0);
    scene.add(skyFill);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.85);
    rimLight.position.set(0, 4.5, -6.0);
    scene.add(rimLight);
  }

  private buildRealisticTreeStage(
    THREE: ThreeModule,
    EzTreeCtor: typeof EzTreeType,
    scene: ThreeTypes.Scene
  ): void {
    const treeGroup = new THREE.Group();
    this.treeGroup = treeGroup;
    scene.add(treeGroup);

    // 1. Soft Studio Contact Shadow on Ground
    const shadowTex = this.createGroundShadowTexture(THREE);
    this.sharedShadowTexture = shadowTex;
    if (shadowTex) {
      const shadowGeo = this.trackGeo(new THREE.PlaneGeometry(3.8, 3.8));
      const shadowMat = this.trackMat(
        new THREE.MeshBasicMaterial({
          map: shadowTex,
          transparent: true,
          opacity: 0.45,
          depthWrite: false
        })
      );
      const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
      shadowMesh.rotation.x = -Math.PI / 2;
      shadowMesh.position.y = -2.02;
      treeGroup.add(shadowMesh);
    }

    // 2. Clean #F8FAFC Ceramic Planter + #329DD2 Rim + #EB2F33 19•11 Plaque
    const ceramicMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xf8fafc,
        roughness: 0.28,
        metalness: 0.06
      })
    );
    const blueBandMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x329dd2,
        roughness: 0.32,
        metalness: 0.18
      })
    );
    const soilMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x3f4f2f,
        roughness: 0.96
      })
    );

    const potGeo = this.trackGeo(new THREE.CylinderGeometry(0.76, 0.56, 0.56, 36));
    const potMesh = new THREE.Mesh(potGeo, ceramicMat);
    potMesh.position.y = -1.72;
    treeGroup.add(potMesh);

    const rimGeo = this.trackGeo(new THREE.TorusGeometry(0.77, 0.04, 16, 42));
    const rimMesh = new THREE.Mesh(rimGeo, blueBandMat);
    rimMesh.rotation.x = Math.PI / 2;
    rimMesh.position.y = -1.45;
    treeGroup.add(rimMesh);

    const lowerRingGeo = this.trackGeo(new THREE.TorusGeometry(0.58, 0.022, 12, 36));
    const lowerRing = new THREE.Mesh(lowerRingGeo, blueBandMat);
    lowerRing.rotation.x = Math.PI / 2;
    lowerRing.position.y = -1.96;
    treeGroup.add(lowerRing);

    const soilGeo = this.trackGeo(new THREE.CylinderGeometry(0.72, 0.72, 0.06, 32));
    const soilMesh = new THREE.Mesh(soilGeo, soilMat);
    soilMesh.position.y = -1.46;
    treeGroup.add(soilMesh);

    const plaqueTex = this.createPlaqueTexture(THREE);
    this.sharedPlaqueTexture = plaqueTex;
    if (plaqueTex) {
      const plaqueGeo = this.trackGeo(new THREE.PlaneGeometry(0.48, 0.22));
      const plaqueMat = this.trackMat(
        new THREE.MeshStandardMaterial({
          map: plaqueTex,
          roughness: 0.28,
          metalness: 0.08
        })
      );
      const plaqueMesh = new THREE.Mesh(plaqueGeo, plaqueMat);
      plaqueMesh.position.set(0, -1.71, 0.67);
      plaqueMesh.rotation.x = -0.18;
      treeGroup.add(plaqueMesh);
    }

    // 3. Realistic Procedural Oak Tree via @dgreenheck/ez-tree
    const ezTree = new EzTreeCtor();
    ezTree.loadPreset('Oak Medium');
    ezTree.options.leaves.count = 24;
    ezTree.options.leaves.size = 2.65;
    ezTree.options.leaves.tint = 0xe7f9dc;
    ezTree.options.bark.tint = 0xdecbb7;
    ezTree.generate();

    const box = new THREE.Box3().setFromObject(ezTree);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = 3.9 / Math.max(size.y, 1);

    ezTree.scale.setScalar(scale);
    ezTree.position.set(
      -center.x * scale,
      -1.48 - box.min.y * scale,
      -center.z * scale
    );
    treeGroup.add(ezTree);
    this.ezTree = ezTree;

    // Sample outer canopy coordinates for natural branch-to-ribbon photo hanging
    this.extractCanopyAnchors(THREE, ezTree, scale, ezTree.position);

    // 4. Add a few cheerful mini 3D celebration balloons floating near the upper canopy
    this.buildTreeMiniBalloons(THREE, treeGroup);

    // 5. Group for Hanging Polaroids
    const photoGroup = new THREE.Group();
    this.photoGroup = photoGroup;
    treeGroup.add(photoGroup);
  }

  private extractCanopyAnchors(
    THREE: ThreeModule,
    ezTree: EzTreeType,
    scale: number,
    offset: ThreeTypes.Vector3
  ): void {
    this.canopySamples = [];
    this.canopyMaxRadius = 1.65;

    const verts = ezTree.leaves?.verts || [];
    const step = Math.max(1, Math.floor(verts.length / 3 / 600)) * 3;
    let maxR = 1.4;

    for (let i = 0; i < verts.length; i += step) {
      const wx = verts[i] * scale + offset.x;
      const wy = verts[i + 1] * scale + offset.y;
      const wz = verts[i + 2] * scale + offset.z;
      const r = Math.hypot(wx, wz);
      if (r > maxR) maxR = r;
      if (wy >= 0.05 && wy <= 1.65 && r >= 0.65) {
        this.canopySamples.push(new THREE.Vector3(wx, wy, wz));
      }
    }
    this.canopyMaxRadius = Math.min(Math.max(maxR, 1.45), 2.15);
  }

  private findNearestCanopyAnchor(
    THREE: ThreeModule,
    angle: number,
    desiredY: number,
    fallbackRadius: number
  ): ThreeTypes.Vector3 {
    const dirX = Math.sin(angle);
    const dirZ = Math.cos(angle);
    let best: ThreeTypes.Vector3 | null = null;
    let bestScore = Infinity;

    for (const pt of this.canopySamples) {
      const r = Math.hypot(pt.x, pt.z);
      if (r < 0.75) continue;
      const ptAngle = Math.atan2(pt.x, pt.z);
      const angleDiff = Math.abs(this.wrapAngle(ptAngle - angle));
      if (angleDiff > 0.55) continue;

      const yDiff = Math.abs(pt.y - desiredY);
      const score = angleDiff * 2.2 + yDiff * 1.1 - r * 0.35;
      if (score < bestScore) {
        bestScore = score;
        best = pt;
      }
    }

    if (best) {
      return best.clone();
    }
    return new THREE.Vector3(dirX * fallbackRadius, desiredY, dirZ * fallbackRadius);
  }

  private buildTreeMiniBalloons(THREE: ThreeModule, treeGroup: ThreeTypes.Group): void {
    this.miniBalloons = [];
    const balloonSpecs = [
      { angle: 0.55, r: 1.48, y: 1.88, color: 0x329dd2, scale: 1.0 },
      { angle: 2.35, r: 1.42, y: 1.98, color: 0xeb2f33, scale: 0.92 },
      { angle: 4.15, r: 1.5, y: 1.84, color: 0xf8fafc, scale: 0.95 },
      { angle: 5.55, r: 1.38, y: 2.02, color: 0x329dd2, scale: 0.88 }
    ];

    const sphereGeo = this.trackGeo(new THREE.SphereGeometry(0.14, 18, 16));
    const stringGeo = this.trackGeo(new THREE.CylinderGeometry(0.005, 0.005, 0.55, 6));
    const stringMat = this.trackMat(
      new THREE.MeshBasicMaterial({ color: 0x329dd2, transparent: true, opacity: 0.55 })
    );

    balloonSpecs.forEach((spec, idx) => {
      const mat = this.trackMat(
        new THREE.MeshStandardMaterial({
          color: spec.color,
          roughness: 0.2,
          metalness: 0.12
        })
      );

      const group = new THREE.Group();
      const bx = Math.sin(spec.angle) * spec.r;
      const bz = Math.cos(spec.angle) * spec.r;
      group.position.set(bx, spec.y, bz);

      const bulb = new THREE.Mesh(sphereGeo, mat);
      bulb.scale.set(spec.scale, spec.scale * 1.22, spec.scale);
      group.add(bulb);

      const stringMesh = new THREE.Mesh(stringGeo, stringMat);
      stringMesh.position.y = -0.34;
      group.add(stringMesh);

      treeGroup.add(group);
      this.miniBalloons.push({ group, baseY: spec.y, phase: idx * 1.4 });
    });

    // Background rising 3D sky balloons floating smoothly past the tree
    this.skyBalloons = [];
    const skySpecs = [
      { x: -1.9, z: -1.3, y: -1.4, color: 0x329dd2, speed: 0.42 },
      { x: 1.85, z: -1.1, y: -0.2, color: 0xeb2f33, speed: 0.36 },
      { x: -1.35, z: -1.8, y: 1.1, color: 0xf8fafc, speed: 0.48 },
      { x: 1.35, z: -1.7, y: 2.0, color: 0x329dd2, speed: 0.4 }
    ];
    skySpecs.forEach((spec, idx) => {
      const mat = this.trackMat(
        new THREE.MeshStandardMaterial({
          color: spec.color,
          roughness: 0.22,
          metalness: 0.1
        })
      );
      const group = new THREE.Group();
      group.position.set(spec.x, spec.y, spec.z);

      const bulb = new THREE.Mesh(sphereGeo, mat);
      bulb.scale.set(0.85, 1.04, 0.85);
      group.add(bulb);

      const stringMesh = new THREE.Mesh(stringGeo, stringMat);
      stringMesh.position.y = -0.3;
      group.add(stringMesh);

      this.scene?.add(group);
      this.skyBalloons.push({
        group,
        baseX: spec.x,
        baseZ: spec.z,
        speed: spec.speed,
        phase: idx * 1.7
      });
    });
  }

  private buildFestiveParticles(THREE: ThreeModule, scene: ThreeTypes.Scene): void {
    const count = 56;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const colorChoices = [
      new THREE.Color(0x329dd2),
      new THREE.Color(0x7cc8ee),
      new THREE.Color(0xffffff),
      new THREE.Color(0xeb2f33)
    ];

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 1.45 + Math.random() * 2.2;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = -1.7 + Math.random() * 4.3;
      positions[i * 3 + 2] = Math.sin(angle) * radius;

      // Mostly sky blue & crisp white, occasional red accent spark
      const c = i % 7 === 0 ? colorChoices[3] : colorChoices[i % 3];
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    const geo = this.trackGeo(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const spriteTex = this.createSparkleSpriteTexture(THREE);
    this.sharedSparkleTexture = spriteTex;

    const mat = this.trackMat(
      new THREE.PointsMaterial({
        size: 0.1,
        map: spriteTex || undefined,
        vertexColors: true,
        transparent: true,
        opacity: 0.78,
        depthWrite: false
      })
    );

    const points = new THREE.Points(geo, mat);
    this.dustPoints = points;
    scene.add(points);
  }

  // ===== DYNAMIC HANGING PHOTO CARDS =====

  private rebuildPhotoOrnaments(): void {
    const THREE = this.THREE;
    const photoGroup = this.photoGroup;
    if (!THREE || !photoGroup) return;

    this.disposePhotoNodes();
    while (photoGroup.children.length > 0) {
      photoGroup.remove(photoGroup.children[0]);
    }

    const items = this.photos || [];
    this.lastPhotosSignature = this.computePhotosSignature(items);
    if (items.length === 0) return;

    if (!this.sharedBackTexture) {
      this.sharedBackTexture = this.createCardBackTexture(THREE);
    }

    const blueRibbonMat = new THREE.MeshStandardMaterial({ color: 0x329dd2, roughness: 0.35 });
    const redRibbonMat = new THREE.MeshStandardMaterial({ color: 0xeb2f33, roughness: 0.35 });
    const clipMat = new THREE.MeshStandardMaterial({ color: 0x329dd2, roughness: 0.25, metalness: 0.5 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.45, metalness: 0.04 });
    this.photoBranchMaterials.push(blueRibbonMat, redRibbonMat, clipMat, frameMat);

    const total = items.length;
    const clipGeo = new THREE.BoxGeometry(0.11, 0.07, 0.055);
    this.photoBranchGeometries.push(clipGeo);

    items.forEach((photo, index) => {
      const angle = total === 1 ? 0 : (index / total) * Math.PI * 2;
      const desiredBranchY = total <= 3 ? 0.65 + (index % 2) * 0.22 : 0.72 + Math.sin(index * 1.9) * 0.28;
      const boughAnchor = this.findNearestCanopyAnchor(
        THREE,
        angle,
        desiredBranchY,
        this.canopyMaxRadius * 0.85
      );

      // Hang cleanly at outer canopy bough so real leaves frame the card naturally
      const hangRadius = Math.max(Math.hypot(boughAnchor.x, boughAnchor.z) + 0.04, this.canopyMaxRadius * 0.92);
      const cardHangX = Math.sin(angle) * hangRadius;
      const cardHangZ = Math.cos(angle) * hangRadius;
      const ribbonTopY = Math.max(boughAnchor.y, 0.58);
      const ribbonLen = 0.42;

      // Anchor Group positioned at real branch outer hang point
      const anchorGroup = new THREE.Group();
      anchorGroup.position.set(cardHangX, ribbonTopY, cardHangZ);
      anchorGroup.rotation.y = angle;
      photoGroup.add(anchorGroup);

      // Sway Pivot
      const swayPivot = new THREE.Group();
      anchorGroup.add(swayPivot);

      // Vertical Satin Ribbon (#329DD2 or accent #EB2F33)
      const ribbonGeo = new THREE.CylinderGeometry(0.011, 0.011, ribbonLen, 6);
      this.photoBranchGeometries.push(ribbonGeo);
      const ribbonMesh = new THREE.Mesh(ribbonGeo, index === 0 ? redRibbonMat : blueRibbonMat);
      ribbonMesh.position.set(0, -ribbonLen * 0.5, 0);
      swayPivot.add(ribbonMesh);

      const clipMesh = new THREE.Mesh(clipGeo, clipMat);
      clipMesh.position.set(0, -ribbonLen, 0.005);
      swayPivot.add(clipMesh);

      // Polaroid Card Group
      const defaultW = 0.74;
      const defaultH = 0.94;
      const cardGroup = new THREE.Group();
      cardGroup.position.set(0, -ribbonLen - 0.02 - defaultH * 0.5, 0);
      cardGroup.rotation.x = -0.04;
      swayPivot.add(cardGroup);

      const backingGeo = new THREE.BoxGeometry(defaultW, defaultH, 0.032);
      const backingMesh = new THREE.Mesh(backingGeo, frameMat);
      cardGroup.add(backingMesh);

      const isVid = this.isVideoMedia?.(photo) ?? false;
      const placeholderTex = this.createPolaroidCanvasTexture(
        THREE,
        null,
        this.getPhotoLabel(photo, index),
        isVid,
        defaultW / defaultH
      );

      const frontGeo = new THREE.PlaneGeometry(defaultW - 0.03, defaultH - 0.03);
      const frontMat = new THREE.MeshBasicMaterial({ map: placeholderTex });
      const frontMesh = new THREE.Mesh(frontGeo, frontMat);
      frontMesh.position.z = 0.018;
      cardGroup.add(frontMesh);

      const backGeo = new THREE.PlaneGeometry(defaultW - 0.03, defaultH - 0.03);
      const backMat = new THREE.MeshBasicMaterial({
        map: this.sharedBackTexture || undefined,
        color: this.sharedBackTexture ? 0xffffff : 0x329dd2
      });
      const backMesh = new THREE.Mesh(backGeo, backMat);
      backMesh.position.z = -0.018;
      backMesh.rotation.y = Math.PI;
      cardGroup.add(backMesh);

      const hitMeshes: ThreeTypes.Object3D[] = [backingMesh, frontMesh, backMesh, clipMesh];
      hitMeshes.forEach(m => {
        m.userData['photoIndex'] = index;
      });

      const node: PhotoNodeRecord = {
        index,
        photo,
        anchorGroup,
        swayPivot,
        cardGroup,
        backingMesh,
        frontMesh,
        backMesh,
        hitMeshes,
        angle,
        baseScale: 1,
        texture: placeholderTex
      };
      this.photoNodes.push(node);

      if (!isVid) {
        this.loadPhotoTextureIntoNode(node, index);
      }
    });

    if (this.photoNodes.length > 0 && this.lastEmittedFrontIndex === -1) {
      this.currentRotationY = -this.photoNodes[0].angle;
      this.updateTreeTransforms();
    }
    this.renderSingleFrame();
  }

  private loadPhotoTextureIntoNode(node: PhotoNodeRecord, index: number): void {
    const THREE = this.THREE;
    if (!THREE) return;
    const rawUrl = this.getPhotoPreviewUrl ? this.getPhotoPreviewUrl(node.photo) : node.photo.thumbnailUrl;
    if (!rawUrl) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';

    img.onload = () => {
      if (this.destroyed || !this.photoNodes.includes(node)) return;
      this.applyImageToNode(node, img, index);
    };

    img.onerror = () => {
      void this.tryBlobImageFallback(rawUrl, node, index);
    };

    img.src = rawUrl;
  }

  private async tryBlobImageFallback(url: string, node: PhotoNodeRecord, index: number): Promise<void> {
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const fallbackImg = new Image();
      fallbackImg.onload = () => {
        URL.revokeObjectURL(objUrl);
        if (this.destroyed || !this.photoNodes.includes(node)) return;
        this.applyImageToNode(node, fallbackImg, index);
      };
      fallbackImg.onerror = () => URL.revokeObjectURL(objUrl);
      fallbackImg.src = objUrl;
    } catch {
      // Keep placeholder card cleanly
    }
  }

  private applyImageToNode(node: PhotoNodeRecord, img: HTMLImageElement, index: number): void {
    const THREE = this.THREE;
    if (!THREE) return;

    const natW = Math.max(img.naturalWidth || 3, 1);
    const natH = Math.max(img.naturalHeight || 4, 1);
    const ratio = natW / natH;

    let cardW = 0.76;
    let cardH = 0.94;
    if (ratio < 0.55) {
      cardW = 0.52;
      cardH = Math.min(Math.max(cardW / ratio + 0.14, 0.96), 1.3);
    } else if (ratio < 0.95) {
      cardW = 0.72;
      cardH = Math.min(Math.max(cardW / ratio + 0.14, 0.86), 1.1);
    } else {
      cardW = 0.88;
      cardH = Math.min(Math.max(cardW / ratio + 0.15, 0.68), 0.94);
    }

    node.cardGroup.position.set(0, -0.48 - cardH * 0.5, 0);

    node.backingMesh.geometry.dispose();
    node.backingMesh.geometry = new THREE.BoxGeometry(cardW, cardH, 0.032);

    node.frontMesh.geometry.dispose();
    node.frontMesh.geometry = new THREE.PlaneGeometry(cardW - 0.028, cardH - 0.028);

    node.backMesh.geometry.dispose();
    node.backMesh.geometry = new THREE.PlaneGeometry(cardW - 0.028, cardH - 0.028);

    const newTex = this.createPolaroidCanvasTexture(
      THREE,
      img,
      this.getPhotoLabel(node.photo, index),
      false,
      ratio
    );

    node.texture?.dispose();
    node.texture = newTex;

    const frontMat = node.frontMesh.material as ThreeTypes.MeshBasicMaterial;
    frontMat.map = newTex;
    frontMat.needsUpdate = true;

    this.renderSingleFrame();
  }

  private createPolaroidCanvasTexture(
    THREE: ThreeModule,
    img: HTMLImageElement | null,
    label: string,
    isVideo: boolean,
    photoAspect: number
  ): ThreeTypes.CanvasTexture {
    const canvas = document.createElement('canvas');
    const width = 512;
    const clampedAspect = Math.min(Math.max(photoAspect || 0.75, 0.38), 1.5);
    const photoDrawH = Math.round((width - 48) / clampedAspect);
    const height = Math.min(Math.max(photoDrawH + 116, 420), 980);

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = '#329DD2';
      ctx.lineWidth = 4;
      ctx.strokeRect(10, 10, width - 20, height - 20);

      const padX = 24;
      const padTop = 24;
      const imgW = width - padX * 2;
      const imgH = height - 108;

      if (img) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect?.(padX, padTop, imgW, imgH, 8);
        if (!ctx.roundRect) ctx.rect(padX, padTop, imgW, imgH);
        ctx.clip();

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        const drawRatio = imgW / imgH;
        const natRatio = img.naturalWidth / Math.max(img.naturalHeight, 1);
        let sx = 0;
        let sy = 0;
        let sw = img.naturalWidth;
        let sh = img.naturalHeight;

        if (natRatio > drawRatio * 1.04) {
          sw = img.naturalHeight * drawRatio;
          sx = (img.naturalWidth - sw) * 0.5;
        } else if (natRatio < drawRatio * 0.96) {
          sh = img.naturalWidth / drawRatio;
          sy = (img.naturalHeight - sh) * 0.5;
        }

        ctx.drawImage(img, sx, sy, sw, sh, padX, padTop, imgW, imgH);
        ctx.restore();
      } else {
        const grad = ctx.createLinearGradient(padX, padTop, padX + imgW, padTop + imgH);
        grad.addColorStop(0, '#1e6e99');
        grad.addColorStop(1, '#329DD2');
        ctx.fillStyle = grad;
        ctx.fillRect(padX, padTop, imgW, imgH);

        if (isVideo) {
          const cx = padX + imgW / 2;
          const cy = padTop + imgH / 2 - 14;
          ctx.beginPath();
          ctx.arc(cx, cy, 56, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(248, 250, 252, 0.24)';
          ctx.fill();
          ctx.lineWidth = 4;
          ctx.strokeStyle = '#F8FAFC';
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(cx - 16, cy - 24);
          ctx.lineTo(cx + 28, cy);
          ctx.lineTo(cx - 16, cy + 24);
          ctx.closePath();
          ctx.fillStyle = '#FFFFFF';
          ctx.fill();

          ctx.fillStyle = '#F8FAFC';
          ctx.font = '700 24px "Plus Jakarta Sans", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('VIDEO BTS', cx, cy + 92);
        } else {
          ctx.fillStyle = '#F8FAFC';
          ctx.font = '600 22px "Plus Jakarta Sans", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('Đang tải ảnh...', width / 2, padTop + imgH / 2);
        }
      }

      const footerY = height - 42;
      ctx.fillStyle = '#15597d';
      ctx.font = '700 22px "Playfair Display", Georgia, serif';
      ctx.textAlign = 'left';
      ctx.fillText(label.slice(0, 22), padX + 4, footerY);

      // Subtle #EB2F33 19•11 date stamp
      ctx.fillStyle = '#EB2F33';
      ctx.font = '800 20px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('19•11', width - padX - 4, footerY);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(this.renderer?.capabilities.getMaxAnisotropy() || 4, 4);
    texture.needsUpdate = true;
    return texture;
  }

  private createCardBackTexture(THREE: ThreeModule): ThreeTypes.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 320;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 256, 320);
      grad.addColorStop(0, '#329DD2');
      grad.addColorStop(1, '#1b6e99');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 320);

      ctx.strokeStyle = '#F8FAFC';
      ctx.lineWidth = 6;
      ctx.strokeRect(14, 14, 228, 292);

      ctx.fillStyle = '#F8FAFC';
      ctx.textAlign = 'center';
      ctx.font = '700 26px Georgia, serif';
      ctx.fillText('TÁCH TÁCH', 128, 142);
      ctx.font = '700 18px sans-serif';
      ctx.fillText("MEN'S DAY", 128, 174);

      ctx.fillStyle = '#EB2F33';
      ctx.fillRect(88, 194, 80, 6);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private createPlaqueTexture(THREE: ThreeModule): ThreeTypes.CanvasTexture | null {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = '#329DD2';
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, 244, 116);

    ctx.fillStyle = '#329DD2';
    ctx.textAlign = 'center';
    ctx.font = '700 38px Georgia, serif';
    ctx.fillText('19 • 11', 128, 66);

    ctx.fillStyle = '#EB2F33';
    ctx.font = '800 19px sans-serif';
    ctx.fillText("MEN'S DAY", 128, 98);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private createGroundShadowTexture(THREE: ThreeModule): ThreeTypes.CanvasTexture | null {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
    grad.addColorStop(0, 'rgba(30, 80, 120, 0.55)');
    grad.addColorStop(0.55, 'rgba(50, 157, 210, 0.22)');
    grad.addColorStop(1, 'rgba(50, 157, 210, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    return new THREE.CanvasTexture(canvas);
  }

  private createSparkleSpriteTexture(THREE: ThreeModule): ThreeTypes.CanvasTexture | null {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.45, 'rgba(255, 255, 255, 0.72)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);

    return new THREE.CanvasTexture(canvas);
  }

  // ===== ANIMATION & PHYSICS LOOP =====

  private syncAnimationLoop(): void {
    const shouldAnimate =
      !this.destroyed &&
      !this.paused &&
      !this.isOffScreen &&
      !this.isTabHidden &&
      Boolean(this.renderer);

    if (!shouldAnimate) {
      this.stopAnimationLoop();
      return;
    }

    if (this.rafId === null) {
      this.lastClockTime = performance.now();
      this.ngZone.runOutsideAngular(() => {
        this.rafId = requestAnimationFrame(this.animateFrame);
      });
    }
  }

  private stopAnimationLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private readonly animateFrame = (now: number): void => {
    if (this.destroyed || this.paused || this.isOffScreen || this.isTabHidden) {
      this.rafId = null;
      return;
    }

    const dt = Math.min((now - this.lastClockTime) / 1000, 0.05);
    this.lastClockTime = now;
    this.elapsedTime += dt;

    // 1. Update Tree Rotation (Auto-rotates by default!)
    if (this.holdSpinDir !== 0) {
      this.currentRotationY += this.holdSpinDir * dt * 1.95;
    } else if (this.targetRotationY !== null) {
      const diff = this.targetRotationY - this.currentRotationY;
      if (Math.abs(diff) < 0.004) {
        this.currentRotationY = this.targetRotationY;
        this.targetRotationY = null;
      } else {
        this.currentRotationY += diff * Math.min(dt * 8.5, 0.35);
      }
    } else if (this.activePointerId === null) {
      if (Math.abs(this.velocityY) > 0.0004) {
        this.currentRotationY += this.velocityY;
        this.velocityY *= Math.pow(0.92, dt * 60);
      } else if (this.isAutoRotating()) {
        const autoSpeed = this.prefersReducedMotion ? 0.16 : 0.34;
        this.currentRotationY += dt * autoSpeed;
      }
    }

    // 2. Smooth Camera Pitch
    this.cameraPitch += (this.targetCameraPitch - this.cameraPitch) * Math.min(dt * 8, 1);

    // 3. Realistic wind breeze on oak leaves + floating balloons + hanging cards
    if (this.ezTree && !this.prefersReducedMotion) {
      this.ezTree.update(this.elapsedTime * 1.4);
    }
    this.updateTreeTransforms();
    this.updateAmbientEffects(dt);
    this.renderSingleFrame();

    this.rafId = requestAnimationFrame(this.animateFrame);
  };

  private updateTreeTransforms(): void {
    if (this.treeGroup) {
      this.treeGroup.rotation.y = this.currentRotationY;
    }
    if (this.camera) {
      const baseZ = this.camera.userData['baseZ'] || 6.85;
      this.camera.position.y = 0.78 + Math.sin(this.cameraPitch) * 2.1;
      this.camera.position.z = baseZ;
      this.camera.lookAt(0, 0.08, 0);
    }

    let closestIdx = 0;
    let smallestAbsAngle = Infinity;
    for (const node of this.photoNodes) {
      const effectiveAngle = Math.abs(this.wrapAngle(node.angle + this.currentRotationY));
      if (effectiveAngle < smallestAbsAngle) {
        smallestAbsAngle = effectiveAngle;
        closestIdx = node.index;
      }
    }

    if (closestIdx !== this.lastEmittedFrontIndex) {
      this.lastEmittedFrontIndex = closestIdx;
      this.ngZone.run(() => {
        this.frontPhotoIndex.set(closestIdx);
        this.frontIndexChange.emit(closestIdx);
      });
    }

    const hovered = this.hoveredPhotoIndex();
    for (const node of this.photoNodes) {
      if (!this.prefersReducedMotion) {
        node.swayPivot.rotation.z = Math.sin(this.elapsedTime * 1.4 + node.index * 1.6) * 0.03;
        node.swayPivot.rotation.x = Math.cos(this.elapsedTime * 1.1 + node.index * 1.2) * 0.02;
      } else {
        node.swayPivot.rotation.set(0, 0, 0);
      }

      const isFront = node.index === closestIdx;
      const isHover = node.index === hovered;
      const targetScale = isHover ? 1.12 : isFront ? 1.07 : 0.96;
      node.baseScale += (targetScale - node.baseScale) * 0.14;
      node.cardGroup.scale.setScalar(node.baseScale);
    }
  }

  private updateAmbientEffects(dt: number): void {
    const motionFactor = this.prefersReducedMotion ? 0.55 : 1;

    for (const b of this.miniBalloons) {
      b.group.position.y = b.baseY + Math.sin(this.elapsedTime * 2.0 * motionFactor + b.phase) * 0.12;
      b.group.rotation.z = Math.sin(this.elapsedTime * 1.4 * motionFactor + b.phase) * 0.1;
    }

    if (this.isAutoRotating()) {
      for (const sb of this.skyBalloons) {
        let nextY = sb.group.position.y + dt * sb.speed * motionFactor;
        if (nextY > 3.1) {
          nextY = -2.2;
        }
        sb.group.position.y = nextY;
        sb.group.position.x = sb.baseX + Math.sin(this.elapsedTime * 1.1 + sb.phase) * 0.18;
        sb.group.rotation.z = Math.sin(this.elapsedTime * 1.3 + sb.phase) * 0.08;
      }
    }

    if (this.dustPoints && !this.prefersReducedMotion) {
      const posAttr = this.dustPoints.geometry.attributes['position'];
      for (let i = 0; i < posAttr.count; i++) {
        let y = posAttr.getY(i) + dt * 0.16;
        if (y > 2.7) y = -1.8;
        posAttr.setY(i, y);
      }
      posAttr.needsUpdate = true;
      this.dustPoints.rotation.y -= dt * 0.05;
    }
  }

  private renderSingleFrame(): void {
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  // ===== RAYCASTING & STEP HELPERS =====

  private raycastPhotoIndex(clientX: number, clientY: number): number | null {
    const THREE = this.THREE;
    const renderer = this.renderer;
    const camera = this.camera;
    if (!THREE || !renderer || !camera || this.photoNodes.length === 0) return null;

    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.treeGroup?.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

    const targets = this.photoNodes.flatMap(n => n.hitMeshes);
    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length > 0) {
      const idx = hits[0].object.userData['photoIndex'];
      return typeof idx === 'number' ? idx : null;
    }
    return null;
  }

  private stepPhotoByDirection(direction: -1 | 1): void {
    const total = this.photos.length;
    if (total === 0) return;
    if (total === 1) {
      this.targetRotationY = this.currentRotationY + direction * (Math.PI * 0.5);
      this.syncAnimationLoop();
      return;
    }
    const current = this.frontPhotoIndex();
    const next = (current + direction + total) % total;
    this.rotateToPhoto(next);
  }

  private handleResize(width: number, height: number): void {
    if (!this.renderer || !this.camera) return;
    this.renderer.setSize(width, height);
    this.updateCameraLayout(width, height);
    this.renderSingleFrame();
  }

  private updateCameraLayout(width: number, height: number): void {
    if (!this.camera) return;
    const aspect = width / Math.max(height, 1);
    this.camera.aspect = aspect;
    const baseZ = aspect < 0.92 ? 7.05 + (0.92 - aspect) * 3.1 : 6.85;
    this.camera.userData['baseZ'] = Math.min(Math.max(baseZ, 6.6), 8.6);
    this.camera.position.z = this.camera.userData['baseZ'];
    this.camera.updateProjectionMatrix();
  }

  private setupOffscreenPause(): void {
    const stageEl = this.stageContainer?.nativeElement;
    if (!stageEl) return;

    stageEl.addEventListener('contentvisibilityautostatechange', this.contentVisibilityHandler);

    const supportsContentVisibility =
      typeof document !== 'undefined' && 'contentVisibility' in document.documentElement.style;

    if (!supportsContentVisibility && typeof IntersectionObserver !== 'undefined') {
      this.intersectionObserver = new IntersectionObserver(
        entries => {
          for (const entry of entries) {
            this.isOffScreen = !entry.isIntersecting;
            this.syncAnimationLoop();
          }
        },
        { rootMargin: '150px' }
      );
      this.intersectionObserver.observe(stageEl);
    }
  }

  private clearHoldTimers(): void {
    if (this.holdPressTimer !== null) {
      clearTimeout(this.holdPressTimer);
      this.holdPressTimer = null;
    }
  }

  private wrapAngle(angle: number): number {
    let a = angle % (Math.PI * 2);
    if (a > Math.PI) a -= Math.PI * 2;
    if (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  private computePhotosSignature(photos: GalleryPhoto[]): string {
    return (photos || []).map(p => `${p.mediaId}:${p.kind}:${p.role || ''}`).join('|');
  }

  private trackGeo<T extends ThreeTypes.BufferGeometry>(geo: T): T {
    this.disposableGeometries.push(geo);
    return geo;
  }

  private trackMat<T extends ThreeTypes.Material>(mat: T): T {
    this.disposableMaterials.push(mat);
    return mat;
  }

  private disposeEzTreeResources(): void {
    if (!this.ezTree) return;
    this.ezTree.branchesMesh?.geometry?.dispose();
    const bMat = this.ezTree.branchesMesh?.material;
    if (Array.isArray(bMat)) bMat.forEach(m => m.dispose());
    else bMat?.dispose();

    this.ezTree.leavesMesh?.geometry?.dispose();
    const lMat = this.ezTree.leavesMesh?.material;
    if (Array.isArray(lMat)) lMat.forEach(m => m.dispose());
    else lMat?.dispose();
    this.ezTree = null;
  }

  private disposePhotoNodes(): void {
    for (const geo of this.photoBranchGeometries) {
      geo.dispose();
    }
    this.photoBranchGeometries = [];

    for (const mat of this.photoBranchMaterials) {
      mat.dispose();
    }
    this.photoBranchMaterials = [];

    for (const node of this.photoNodes) {
      node.texture?.dispose();
      node.backingMesh.geometry.dispose();
      node.frontMesh.geometry.dispose();
      node.backMesh.geometry.dispose();
      (node.frontMesh.material as ThreeTypes.Material).dispose();
      (node.backMesh.material as ThreeTypes.Material).dispose();
    }
    this.photoNodes = [];
  }
}
