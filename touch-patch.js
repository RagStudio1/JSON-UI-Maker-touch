/**
 * JSON-UI Maker - Mobile Touch Patch v2
 *
 * Adds touch/pen support while preserving the original desktop mouse behavior.
 *
 * v2:
 * - Locks the currently selected parent when "Add image" is opened.
 * - Restores that exact parent immediately before Builder.addCanvas() runs.
 *   This fixes images being inserted into the last/underlying nested panel.
 */
(() => {
    "use strict";

    if (window.__JSON_UI_MAKER_TOUCH_PATCH_V2__) return;
    window.__JSON_UI_MAKER_TOUCH_PATCH_V2__ = true;

    const hasTouch =
        navigator.maxTouchPoints > 0 ||
        window.matchMedia?.("(pointer: coarse)").matches;

    const DRAG_THRESHOLD = 6;
    const COMPAT_MOUSE_BLOCK_MS = 900;
    const syntheticMouseEvents = new WeakSet();

    let mainWindow = null;
    let editMode = true;
    let activePointerId = null;
    let downTarget = null;
    let downX = 0;
    let downY = 0;
    let lastX = 0;
    let lastY = 0;
    let dragStarted = false;
    let suppressCompatMouseUntil = 0;

    // Track touch pointers so a second finger immediately hands control
    // back to the browser for native pinch-zoom.
    const activeTouchPointers = new Set();
    let nativePinchActive = false;

    // Parent locked at the exact moment the user presses "Add image".
    let lockedImageParent = null;

    const isEditableControl = (target) =>
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);

    function makeEditorMouseEvent(type, source = null, x = 0, y = 0) {
        const event = new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            detail: type === "dblclick" ? 2 : 1,
            screenX: source?.screenX ?? x,
            screenY: source?.screenY ?? y,
            clientX: x || source?.clientX || 0,
            clientY: y || source?.clientY || 0,
            ctrlKey: source?.ctrlKey ?? false,
            shiftKey: source?.shiftKey ?? false,
            altKey: source?.altKey ?? false,
            metaKey: source?.metaKey ?? false,
            button: 0,
            buttons: type === "mouseup" || type === "dblclick" ? 0 : 1,
        });

        // Mark our own event so the compatibility-mouse blocker does not eat it.
        syntheticMouseEvents.add(event);
        return event;
    }

    function dispatchEditorMouse(target, type, source = null, x = 0, y = 0) {
        if (!(target instanceof EventTarget)) return;
        target.dispatchEvent(makeEditorMouseEvent(type, source, x, y));
    }

    function blockCompatibilityMouse(event) {
        if (syntheticMouseEvents.has(event)) return;
        if (Date.now() > suppressCompatMouseUntil) return;
        if (!(event.target instanceof Node)) return;
        if (!mainWindow?.contains(event.target)) return;

        event.preventDefault();
        event.stopImmediatePropagation();
    }

    function resetGesture() {
        if (downTarget instanceof Element && activePointerId !== null) {
            try {
                if (downTarget.hasPointerCapture?.(activePointerId)) {
                    downTarget.releasePointerCapture(activePointerId);
                }
            } catch (_) {}
        }

        activePointerId = null;
        downTarget = null;
        dragStarted = false;
    }

    function beginSyntheticDrag(event) {
        if (dragStarted || !(downTarget instanceof EventTarget)) return;

        dragStarted = true;
        suppressCompatMouseUntil = Date.now() + COMPAT_MOUSE_BLOCK_MS;
        dispatchEditorMouse(downTarget, "mousedown", event, downX, downY);
    }

    function onPointerDown(event) {
        if (event.pointerType === "mouse") return;

        if (event.pointerType === "touch") {
            activeTouchPointers.add(event.pointerId);

            // Two fingers = native browser pinch zoom.
            if (activeTouchPointers.size >= 2) {
                nativePinchActive = true;

                // Stop any editor drag/resize that may have started with finger 1.
                if (activePointerId !== null) {
                    if (dragStarted && downTarget instanceof EventTarget) {
                        dispatchEditorMouse(
                            downTarget,
                            "mouseup",
                            event,
                            lastX,
                            lastY
                        );
                    }
                    resetGesture();
                }

                // IMPORTANT: do not preventDefault here.
                // touch-action: pinch-zoom below lets Chrome handle the gesture.
                return;
            }
        }

        if (!editMode) return;
        if (nativePinchActive) return;
        if (activePointerId !== null) return;
        if (!(event.target instanceof Node) || !mainWindow?.contains(event.target)) return;

        activePointerId = event.pointerId;
        downTarget = event.target;
        downX = lastX = event.clientX;
        downY = lastY = event.clientY;
        dragStarted = false;

        if (downTarget instanceof Element) {
            try {
                downTarget.setPointerCapture?.(event.pointerId);
            } catch (_) {}
        }

        if (!isEditableControl(event.target)) {
            suppressCompatMouseUntil = Date.now() + COMPAT_MOUSE_BLOCK_MS;

            // Keep one-finger editing native-free, but never block multi-touch pinch.
            if (activeTouchPointers.size < 2) {
                event.preventDefault();
            }
        }
    }

    function onPointerMove(event) {
        if (event.pointerType === "mouse") return;

        // While two fingers are down, completely leave movement to the browser.
        if (nativePinchActive || activeTouchPointers.size >= 2) {
            return;
        }

        if (
            event.pointerId !== activePointerId ||
            !(downTarget instanceof EventTarget)
        ) {
            return;
        }

        lastX = event.clientX;
        lastY = event.clientY;

        const distance = Math.hypot(lastX - downX, lastY - downY);

        if (!dragStarted && distance >= DRAG_THRESHOLD) {
            beginSyntheticDrag(event);
        }

        if (!dragStarted) return;

        event.preventDefault();
        dispatchEditorMouse(downTarget, "mousemove", event, lastX, lastY);
    }

    function onPointerUp(event) {
        if (event.pointerType === "touch") {
            activeTouchPointers.delete(event.pointerId);

            if (nativePinchActive) {
                // Stay out of the browser's way until every finger from the
                // pinch gesture is lifted.
                if (activeTouchPointers.size === 0) {
                    nativePinchActive = false;
                }
                return;
            }
        }

        if (event.pointerType === "mouse" || event.pointerId !== activePointerId) return;

        const target = downTarget;
        const wasDrag = dragStarted;
        const distance = Math.hypot(event.clientX - downX, event.clientY - downY);

        if (wasDrag && target instanceof EventTarget) {
            event.preventDefault();
            dispatchEditorMouse(target, "mouseup", event, event.clientX, event.clientY);
        } else if (distance < DRAG_THRESHOLD && target instanceof Element) {
            if (!target.closest(".resize-handle")) {
                queueMicrotask(() =>
                    dispatchEditorMouse(
                        target,
                        "dblclick",
                        event,
                        event.clientX,
                        event.clientY
                    )
                );
            }
        }

        resetGesture();
    }

    function onPointerCancel(event) {
        if (event.pointerType === "touch") {
            activeTouchPointers.delete(event.pointerId);

            if (activeTouchPointers.size === 0) {
                nativePinchActive = false;
            }
        }

        if (event.pointerType === "mouse" || event.pointerId !== activePointerId) return;

        if (dragStarted && downTarget instanceof EventTarget) {
            dispatchEditorMouse(downTarget, "mouseup", event, lastX, lastY);
        }

        resetGesture();
    }

    function onExplorerPointerUp(event) {
        if (!editMode || event.pointerType === "mouse") return;
        if (!(event.target instanceof Element)) return;

        const explorerText = event.target.closest(".explorerText");
        if (!explorerText) return;

        dispatchEditorMouse(
            explorerText,
            "dblclick",
            event,
            event.clientX,
            event.clientY
        );
    }

    function elementLooksSelected(element) {
        if (!(element instanceof HTMLElement)) return false;

        const outline = `${element.style.outline} ${element.style.outlineColor}`.toLowerCase();
        return (
            outline.includes("blue") ||
            outline.includes("rgb(0, 0, 255)") ||
            outline.includes("rgb(0,0,255)")
        );
    }

    function getSelectedMainElement() {
        if (!mainWindow) return null;

        const candidates = mainWindow.querySelectorAll(
            [
                ".draggable-panel[data-id]",
                ".draggable-canvas[data-id]",
                ".draggable-button[data-id]",
                ".draggable-collection_panel[data-id]",
                ".draggable-scrolling_panel[data-id]",
                ".draggable-label[data-id]",
            ].join(",")
        );

        // Search from the end because nested/newer DOM nodes are usually later.
        for (let i = candidates.length - 1; i >= 0; i--) {
            const element = candidates[i];
            if (elementLooksSelected(element)) return element;
        }

        return null;
    }

    function restoreLockedImageParent() {
        const target = lockedImageParent;

        if (!(target instanceof HTMLElement) || !document.contains(target)) return;
        if (elementLooksSelected(target)) return;

        const rect = target.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;

        // The editor's own dblclick path updates its module-scoped selectedElement.
        dispatchEditorMouse(target, "dblclick", null, x, y);
    }

    function installImageParentLock() {
        const tryInstall = () => {
            const Builder = window.Builder;

            if (!Builder?.openAddImageMenu || !Builder?.addCanvas) {
                setTimeout(tryInstall, 25);
                return;
            }

            if (Builder.__touchImageParentLockInstalled) return;
            Builder.__touchImageParentLockInstalled = true;

            const originalOpenAddImageMenu = Builder.openAddImageMenu;
            const originalAddCanvas = Builder.addCanvas;

            Builder.openAddImageMenu = async function (...args) {
                const previousLock = lockedImageParent;

                // IMPORTANT: snapshot destination BEFORE the image picker opens.
                lockedImageParent = getSelectedMainElement();

                try {
                    return await originalOpenAddImageMenu.apply(this, args);
                } finally {
                    lockedImageParent = previousLock;
                }
            };

            Builder.addCanvas = function (...args) {
                // IMPORTANT: restore destination immediately before original addCanvas
                // reads the editor's global selectedElement.
                restoreLockedImageParent();
                return originalAddCanvas.apply(this, args);
            };

            console.log("[Touch Patch v2] Image parent lock installed.");
        };

        tryInstall();
    }

    function installStyles() {
        const style = document.createElement("style");
        style.id = "json-ui-maker-touch-patch-style";
        style.textContent = `
@media (pointer: coarse) {
    html,
    body {
        touch-action: pan-x pan-y pinch-zoom !important;
    }

    body.jsonui-touch-edit #main_window {
        touch-action: pinch-zoom !important;
        overscroll-behavior: contain;
    }

    body.jsonui-touch-nav #main_window {
        touch-action: pan-x pan-y pinch-zoom !important;
    }

    body.jsonui-touch-edit .resize-handle {
        width: 30px !important;
        height: 30px !important;
        left: calc(100% - 30px) !important;
        top: calc(100% - 30px) !important;
        min-width: 30px;
        min-height: 30px;
    }

    .explorerText,
    .explorerArrow,
    .explorerVisibilityToggle {
        touch-action: manipulation;
    }

    .jsonui-touch-mode-toggle {
        position: fixed;
        right: 14px;
        bottom: 14px;
        z-index: 100000;
        min-width: 132px;
        min-height: 48px;
        padding: 10px 14px;
        border: 2px solid rgba(172, 74, 255, .9);
        border-radius: 12px;
        background: rgba(28, 28, 32, .94);
        color: #fff;
        font: 700 13px/1.15 sans-serif;
        box-shadow: 0 6px 24px rgba(0,0,0,.45);
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
    }

    .jsonui-touch-mode-toggle small {
        display: block;
        margin-top: 3px;
        opacity: .72;
        font-size: 10px;
        font-weight: 500;
    }
}
`;
        document.head.appendChild(style);
    }

    function installModeToggle() {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "jsonui-touch-mode-toggle";
        button.setAttribute("aria-pressed", "true");

        const render = () => {
            document.body.classList.toggle("jsonui-touch-edit", editMode);
            document.body.classList.toggle("jsonui-touch-nav", !editMode);
            button.setAttribute("aria-pressed", String(editMode));

            button.innerHTML = editMode
                ? `TOUCH: EDITAR<small>arrastar / redimensionar</small>`
                : `TOUCH: NAVEGAR<small>rolar / mover a pagina</small>`;
        };

        button.addEventListener("click", () => {
            editMode = !editMode;

            if (!editMode && activePointerId !== null) {
                resetGesture();
            }

            render();
        });

        render();
        document.body.appendChild(button);
    }

    function init() {
        // Explicitly allow native browser zoom even if the original page
        // or a WebView injected a restrictive viewport.
        const viewport = document.querySelector('meta[name="viewport"]');
        if (viewport) {
            viewport.setAttribute(
                "content",
                "width=device-width, initial-scale=1.0, minimum-scale=0.25, maximum-scale=5.0, user-scalable=yes"
            );
        }

        mainWindow = document.getElementById("main_window");
        if (!mainWindow) return;

        installStyles();

        if (hasTouch && window.PointerEvent) {
            ["mousedown", "mousemove", "mouseup", "click", "dblclick"].forEach((type) => {
                document.addEventListener(type, blockCompatibilityMouse, true);
            });

            installModeToggle();

            document.addEventListener("pointerdown", onPointerDown, {
                capture: true,
                passive: false,
            });

            document.addEventListener("pointermove", onPointerMove, {
                capture: true,
                passive: false,
            });

            document.addEventListener("pointerup", onPointerUp, {
                capture: true,
                passive: false,
            });

            document.addEventListener("pointercancel", onPointerCancel, {
                capture: true,
                passive: false,
            });

            const explorer = document.getElementById("explorer");
            explorer?.addEventListener("pointerup", onExplorerPointerUp, {
                passive: true,
            });
        }

        // This fix is useful on mobile and desktop because the original image
        // picker uses an async flow and reads selectedElement only after await.
        installImageParentLock();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
/* ============================================================
 * JSON-UI Maker - Importar da Galeria
 * Adiciona um botão no seletor de imagens para importar PNG,
 * JPG/JPEG ou WEBP diretamente do celular/PC.
 * ============================================================ */
(() => {
    "use strict";

    if (window.__JSON_UI_MAKER_GALLERY_IMPORT__) return;
    window.__JSON_UI_MAKER_GALLERY_IMPORT__ = true;

    function safeName(name) {
        const base = String(name || "imagem")
            .replace(/\.[^.]+$/, "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-zA-Z0-9_-]+/g, "_")
            .replace(/^_+|_+$/g, "")
            .toLowerCase();

        return base || "imagem";
    }

    function uniqueImageKey(images, fileName) {
        const root = `gallery/${safeName(fileName)}`;
        let key = root;
        let i = 2;

        while (images.has(key)) {
            key = `${root}_${i++}`;
        }

        return key;
    }

    function fileToDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error || new Error("Falha ao ler a imagem."));
            reader.readAsDataURL(file);
        });
    }

    function fileToImageData(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = () => {
                const img = new Image();

                img.onload = () => {
                    try {
                        const canvas = document.createElement("canvas");
                        canvas.width = img.naturalWidth || img.width;
                        canvas.height = img.naturalHeight || img.height;

                        const ctx = canvas.getContext("2d", { willReadFrequently: true });
                        if (!ctx) {
                            reject(new Error("Canvas 2D indisponivel."));
                            return;
                        }

                        ctx.drawImage(img, 0, 0);
                        resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
                    } catch (error) {
                        reject(error);
                    } finally {
                        URL.revokeObjectURL(img.src);
                    }
                };

                img.onerror = () => reject(new Error("Formato de imagem invalido."));
                img.src = URL.createObjectURL(file);
            };

            reader.onerror = () => reject(reader.error || new Error("Falha ao ler a imagem."));
            // Apenas força o FileReader a validar acesso ao arquivo.
            reader.readAsArrayBuffer(file);
        });
    }

    function persistImportedImage(key, file, dataUrl) {
        try {
            localStorage.setItem(
                `asset_${key}_png`,
                JSON.stringify({
                    base64: dataUrl,
                    metadata: {
                        name: file.name,
                        type: "png",
                        relativePath: `textures/${key}.png`,
                        importedFromGallery: true,
                        loadedAt: new Date().toISOString(),
                    },
                })
            );
        } catch (error) {
            // A imagem continua funcionando nesta sessão mesmo se o
            // navegador estiver sem espaço no localStorage.
            console.warn("[Gallery Import] Nao foi possivel persistir a imagem:", error);
        }
    }

    function autoChooseImportedImage(form, key) {
        // O chooseImageModal original escuta clicks em ".explorerText".
        // Criamos uma entrada temporária sem extensão e clicamos nela.
        // Assim o Promise original resolve normalmente e o fluxo existente
        // chama Builder.addCanvas(), inclusive respeitando o parent-lock.
        const row = document.createElement("div");
        row.className = "explorerDiv rag-gallery-imported-row";

        const text = document.createElement("div");
        text.className = "explorerText";
        text.textContent = key;

        const badge = document.createElement("span");
        badge.className = "rag-gallery-new-badge";
        badge.textContent = " NOVA";

        row.append(text, badge);
        form.prepend(row);

        requestAnimationFrame(() => {
            text.click();
        });
    }

    function setMessage(wrapper, message, type = "normal") {
        const el = wrapper.querySelector(".rag-gallery-message");
        if (!el) return;

        el.textContent = message;
        el.dataset.type = type;
    }

    function installStyles() {
        if (document.getElementById("ragGalleryImportStyles")) return;

        const style = document.createElement("style");
        style.id = "ragGalleryImportStyles";
        style.textContent = `
.rag-gallery-import-wrapper {
    margin: 12px 0 14px;
    padding: 12px;
    border: 1px solid rgba(153, 0, 255, .45);
    border-radius: 10px;
    background: rgba(20, 20, 22, .72);
}

.rag-gallery-import-button {
    width: 100%;
    min-height: 48px;
    padding: 10px 14px;
    border: 1px solid #a931e9;
    border-radius: 8px;
    background: linear-gradient(135deg, #5a167c, #a31563);
    color: white;
    font-size: 14px;
    font-weight: 800;
    cursor: pointer;
    touch-action: manipulation;
}

.rag-gallery-import-button:disabled {
    opacity: .55;
    cursor: wait;
}

.rag-gallery-import-button:hover:not(:disabled) {
    filter: brightness(1.08);
}

.rag-gallery-message {
    display: block;
    min-height: 16px;
    margin-top: 7px;
    color: #aaa;
    font-size: 11px;
    text-align: center;
}

.rag-gallery-message[data-type="success"] {
    color: #8ff0a7;
}

.rag-gallery-message[data-type="error"] {
    color: #ff9696;
}

.rag-gallery-new-badge {
    margin-left: 8px;
    color: #b852f2;
    font-size: 10px;
    font-weight: 800;
}

@media (pointer: coarse) {
    .rag-gallery-import-button {
        min-height: 54px;
        font-size: 15px;
    }
}
`;
        document.head.appendChild(style);
    }

    function installGalleryButton() {
        const modal = document.getElementById("modalChooseImage");
        const form = modal?.querySelector(".modalChooseImageForm");
        const content = modal?.querySelector(".modal-content");

        if (!modal || !form || !content) {
            setTimeout(installGalleryButton, 100);
            return;
        }

        if (content.querySelector(".rag-gallery-import-wrapper")) return;

        const wrapper = document.createElement("div");
        wrapper.className = "rag-gallery-import-wrapper";

        const button = document.createElement("button");
        button.type = "button";
        button.className = "rag-gallery-import-button";
        button.textContent = "IMPORTAR DA GALERIA";

        const message = document.createElement("span");
        message.className = "rag-gallery-message";
        message.textContent = "PNG, JPG, JPEG ou WEBP";

        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/png,image/jpeg,image/webp";
        input.style.display = "none";
        input.setAttribute("aria-hidden", "true");

        button.addEventListener("click", () => {
            input.value = "";
            input.click();
        });

        input.addEventListener("change", async () => {
            const file = input.files?.[0];
            if (!file) return;

            const images = window.images;

            if (!(images instanceof Map)) {
                setMessage(wrapper, "Mapa de imagens ainda nao carregou.", "error");
                return;
            }

            button.disabled = true;
            button.textContent = "IMPORTANDO...";
            setMessage(wrapper, file.name);

            try {
                const [imageData, dataUrl] = await Promise.all([
                    fileToImageData(file),
                    fileToDataUrl(file),
                ]);

                const key = uniqueImageKey(images, file.name);

                images.set(key, {
                    png: imageData,
                });

                persistImportedImage(key, file, dataUrl);

                setMessage(wrapper, `Importada: ${file.name}`, "success");

                // Se o seletor estiver aberto através de Add image,
                // já escolhe a imagem importada e fecha o modal.
                autoChooseImportedImage(form, key);
            } catch (error) {
                console.error("[Gallery Import]", error);
                setMessage(
                    wrapper,
                    `Erro ao importar: ${error?.message || error}`,
                    "error"
                );
            } finally {
                button.disabled = false;
                button.textContent = "IMPORTAR DA GALERIA";
            }
        });

        wrapper.append(button, message, input);

        // Fica logo acima da lista/pesquisa de imagens.
        content.insertBefore(wrapper, form);
    }

    function initGalleryImport() {
        installStyles();
        installGalleryButton();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initGalleryImport, { once: true });
    } else {
        initGalleryImport();
    }
})();

/* ============================================================
 * JSON-UI Maker - Resize Livre de Imagens
 *
 * Imagens comuns agora podem ser redimensionadas com largura e
 * altura independentes. O painel de propriedades recebe:
 *   - PROPORCAO: LIVRE / TRAVADA
 *   - PREENCHER PAINEL
 * ============================================================ */
(() => {
    "use strict";

    if (window.__JSON_UI_MAKER_FREE_IMAGE_RESIZE__) return;
    window.__JSON_UI_MAKER_FREE_IMAGE_RESIZE__ = true;

    let editorIndex = null;
    let DraggableCanvas = null;
    let originalCanvasResize = null;

    function numberFromCss(value) {
        const n = parseFloat(String(value || ""));
        return Number.isFinite(n) ? n : 0;
    }

    async function installFreeResize() {
        try {
            editorIndex = await import("./dist/index.js");
            const canvasModule = await import("./dist/elements/canvas.js");
            DraggableCanvas = canvasModule.DraggableCanvas;

            if (!DraggableCanvas?.prototype) return;
            if (DraggableCanvas.prototype.__ragFreeResizeInstalled) return;

            DraggableCanvas.prototype.__ragFreeResizeInstalled = true;
            originalCanvasResize = DraggableCanvas.prototype.resize;

            DraggableCanvas.prototype.resize = function (e) {
                // Preserve the editor's original NineSlice resize behavior.
                if (this.nineSlice) {
                    return originalCanvasResize.call(this, e);
                }

                // User can explicitly lock normal images back to aspect ratio.
                if (this.canvasHolder?.dataset?.ragKeepAspect === "true") {
                    return originalCanvasResize.call(this, e);
                }

                if (!this.isResizing || !this.isEditable) return;

                e.stopPropagation();

                const containerRect = this.container.getBoundingClientRect();

                const widthChange = e.clientX - this.resizeStartX;
                const heightChange = e.clientY - this.resizeStartY;

                let newWidth = Math.max(1, this.resizeStartWidth + widthChange);
                let newHeight = Math.max(1, this.resizeStartHeight + heightChange);

                const left = numberFromCss(this.canvasHolder.style.left);
                const top = numberFromCss(this.canvasHolder.style.top);

                const maxWidth = Math.max(1, containerRect.width - left);
                const maxHeight = Math.max(1, containerRect.height - top);

                const outlineWidth =
                    numberFromCss(this.outlineDiv.style.outlineWidth) ||
                    numberFromCss(getComputedStyle(this.outlineDiv).outlineWidth);

                // Match the existing boundary setting without coupling to CONFIG internals.
                // When the selected image is inside the panel, always keep the preview sane.
                const boundaryInput = [...document.querySelectorAll(".propertyInput")]
                    .find((el) =>
                        String(el.previousElementSibling?.textContent || "")
                            .toLowerCase()
                            .includes("boundary")
                    );

                const boundaryEnabled =
                    boundaryInput instanceof HTMLInputElement &&
                    boundaryInput.type === "checkbox" &&
                    boundaryInput.checked;

                if (boundaryEnabled) {
                    newWidth = Math.min(newWidth, maxWidth);
                    newHeight = Math.min(newHeight, maxHeight);
                }

                this.outlineDiv.style.width =
                    `${Math.max(1, newWidth - outlineWidth)}px`;
                this.outlineDiv.style.height =
                    `${Math.max(1, newHeight - outlineWidth)}px`;
            };

            installPropertiesEnhancer();
            console.log("[Touch Patch] Resize livre de imagens instalado.");
        } catch (error) {
            console.error("[Touch Patch] Falha ao instalar resize livre:", error);
        }
    }

    function getSelectedCanvas() {
        const selected = editorIndex?.selectedElement;
        if (!selected || !DraggableCanvas) return null;

        // selectedElement is the main HTMLElement. Resolve its class instance
        // through the editor's public GLOBAL_ELEMENT_MAP.
        const id = selected.dataset?.id;
        if (!id) return null;

        const instance = editorIndex.GLOBAL_ELEMENT_MAP?.get(id);
        return instance instanceof DraggableCanvas ? instance : null;
    }

    function updateAspectButton(button, canvasInstance) {
        const locked =
            canvasInstance.canvasHolder.dataset.ragKeepAspect === "true";

        button.textContent = locked
            ? "PROPORCAO: TRAVADA"
            : "PROPORCAO: LIVRE";

        button.dataset.locked = String(locked);
    }

    function fillParent(canvasInstance) {
        const container = canvasInstance.container;
        const rect = container.getBoundingClientRect();

        if (rect.width <= 0 || rect.height <= 0) return;

        canvasInstance.canvasHolder.style.left = "0px";
        canvasInstance.canvasHolder.style.top = "0px";

        // drawImage already stretches the CSS canvas to the requested size
        // for regular images and performs NineSlice correctly when applicable.
        canvasInstance.drawImage(rect.width, rect.height);

        // Keep the resize helper in sync if it exists.
        if (canvasInstance.outlineDiv) {
            canvasInstance.outlineDiv.style.width = `${rect.width}px`;
            canvasInstance.outlineDiv.style.height = `${rect.height}px`;
        }

        // Refresh editor properties/explorer if those hooks exist.
        try {
            window.Builder?.updateExplorer?.();
        } catch (_) {}
    }

    function injectImageControls() {
        const properties = document.getElementById("properties");
        if (!properties) return;

        const canvasInstance = getSelectedCanvas();

        const previous = properties.querySelector(".rag-image-resize-tools");

        if (!canvasInstance) {
            previous?.remove();
            return;
        }

        if (previous?.dataset?.elementId === canvasInstance.canvasHolder.dataset.id) {
            const aspectButton = previous.querySelector(".rag-aspect-button");
            if (aspectButton) updateAspectButton(aspectButton, canvasInstance);
            return;
        }

        previous?.remove();

        if (canvasInstance.canvasHolder.dataset.ragKeepAspect == null) {
            // New behavior requested: free width/height by default.
            canvasInstance.canvasHolder.dataset.ragKeepAspect = "false";
        }

        const box = document.createElement("div");
        box.className = "rag-image-resize-tools";
        box.dataset.elementId = canvasInstance.canvasHolder.dataset.id || "";

        const title = document.createElement("div");
        title.className = "rag-image-resize-title";
        title.textContent = "IMAGEM";

        const aspectButton = document.createElement("button");
        aspectButton.type = "button";
        aspectButton.className = "propertyInputButton rag-aspect-button";

        updateAspectButton(aspectButton, canvasInstance);

        aspectButton.addEventListener("click", () => {
            const current =
                canvasInstance.canvasHolder.dataset.ragKeepAspect === "true";

            canvasInstance.canvasHolder.dataset.ragKeepAspect =
                String(!current);

            // Refresh ratio from the source image before re-locking.
            if (!current && canvasInstance.imageData?.height) {
                canvasInstance.aspectRatio =
                    canvasInstance.imageData.width /
                    canvasInstance.imageData.height;
            }

            updateAspectButton(aspectButton, canvasInstance);
        });

        const fillButton = document.createElement("button");
        fillButton.type = "button";
        fillButton.className = "propertyInputButton rag-fill-parent-button";
        fillButton.textContent = "PREENCHER PAINEL";

        fillButton.addEventListener("click", () => {
            fillParent(canvasInstance);
        });

        const hint = document.createElement("div");
        hint.className = "rag-image-resize-hint";
        hint.textContent =
            "Livre: largura e altura independentes. Travada: mantem o formato original.";

        box.append(title, aspectButton, fillButton, hint);
        properties.appendChild(box);
    }

    function installPropertiesEnhancer() {
        const properties = document.getElementById("properties");

        if (!properties) {
            setTimeout(installPropertiesEnhancer, 100);
            return;
        }

        if (properties.dataset.ragImageObserver === "true") return;
        properties.dataset.ragImageObserver = "true";

        const observer = new MutationObserver(() => {
            queueMicrotask(injectImageControls);
        });

        observer.observe(properties, {
            childList: true,
            subtree: true,
        });

        // Selection/explorer updates can happen without rebuilding every node.
        document.addEventListener(
            "dblclick",
            () => setTimeout(injectImageControls, 0),
            true
        );

        document
            .getElementById("explorer")
            ?.addEventListener(
                "pointerup",
                () => setTimeout(injectImageControls, 0),
                true
            );

        injectImageControls();
    }

    function installImageResizeStyles() {
        if (document.getElementById("ragImageResizeStyles")) return;

        const style = document.createElement("style");
        style.id = "ragImageResizeStyles";
        style.textContent = `
.rag-image-resize-tools {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid rgba(180, 80, 255, .35);
}

.rag-image-resize-title {
    margin-bottom: 6px;
    color: #c76cff;
    font-size: 11px;
    font-weight: 800;
}

.rag-image-resize-tools button {
    margin-right: 8px;
    margin-bottom: 7px;
    min-height: 34px;
}

.rag-aspect-button[data-locked="false"] {
    outline-color: #a328e7 !important;
}

.rag-fill-parent-button {
    background: linear-gradient(135deg, #4d195f, #74143e) !important;
}

.rag-image-resize-hint {
    max-width: 360px;
    color: #999;
    font-size: 10px;
    line-height: 1.35;
}

@media (pointer: coarse) {
    .rag-image-resize-tools button {
        min-height: 46px;
        padding: 9px 12px;
        font-size: 12px;
    }
}
`;
        document.head.appendChild(style);
    }

    function initFreeImageResize() {
        installImageResizeStyles();
        installFreeResize();
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initFreeImageResize,
            { once: true }
        );
    } else {
        initFreeImageResize();
    }
})();

/* ============================================================
 * JSON-UI Maker - Universal JSON UI Import + Texture Fallback
 *
 * Goals:
 * - Open ordinary Bedrock JSON UI, not only files generated by this editor.
 * - Infer roots and let the user switch between top-level UI definitions.
 * - Render supported controls and best-effort generic panels for unknown ones.
 * - Resolve local @namespace.control inheritance when possible.
 * - Accept common percentage / px / numeric size and offset expressions.
 * - Replace missing texture paths with a visible fallback without aborting.
 * - Swapping/reloading a texture preserves position AND exact footprint.
 * ============================================================ */
(() => {
    "use strict";

    if (window.__JSON_UI_MAKER_UNIVERSAL_IMPORT__) return;
    window.__JSON_UI_MAKER_UNIVERSAL_IMPORT__ = true;

    const STATE = {
        parsed: null,
        namespace: "imported_ui",
        fileName: "",
        rootKeys: [],
        currentRoot: "",
        fallbackPaths: new Set(),
        rawByElementId: new Map(),
        modules: null,
        installed: false,
    };

    window.__RAG_UNIVERSAL_JSON_STATE__ = STATE;

    const CONTROL_TYPES = new Set([
        "panel",
        "image",
        "label",
        "collection_panel",
        "button",
        "stack_panel",
        "grid",
        "input_panel",
        "scroll_view",
        "scrolling_panel",
        "toggle",
        "slider",
        "dropdown",
        "factory",
        "screen",
        "custom",
    ]);

    function sanitizeNamespace(value) {
        let out = String(value || "imported_ui")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9_]+/g, "_")
            .replace(/^_+|_+$/g, "");

        if (!out) out = "imported_ui";
        if (/^[0-9]/.test(out)) out = `ui_${out}`;
        return out.slice(0, 48);
    }

    function stripExtension(name) {
        return String(name || "").replace(/\.[^.]+$/, "");
    }

    function parseJsonc(raw) {
        raw = String(raw || "").replace(/^\uFEFF/, "");

        let out = "";
        let inString = false;
        let escaped = false;
        let lineComment = false;
        let blockComment = false;

        for (let i = 0; i < raw.length; i++) {
            const c = raw[i];
            const n = raw[i + 1];

            if (lineComment) {
                if (c === "\n") {
                    lineComment = false;
                    out += c;
                } else {
                    out += " ";
                }
                continue;
            }

            if (blockComment) {
                if (c === "*" && n === "/") {
                    blockComment = false;
                    out += "  ";
                    i++;
                } else {
                    out += c === "\n" ? "\n" : " ";
                }
                continue;
            }

            if (inString) {
                out += c;

                if (escaped) {
                    escaped = false;
                } else if (c === "\\") {
                    escaped = true;
                } else if (c === '"') {
                    inString = false;
                }

                continue;
            }

            if (c === '"') {
                inString = true;
                out += c;
                continue;
            }

            if (c === "/" && n === "/") {
                lineComment = true;
                out += "  ";
                i++;
                continue;
            }

            if (c === "/" && n === "*") {
                blockComment = true;
                out += "  ";
                i++;
                continue;
            }

            out += c;
        }

        // A surprising number of packs have a trailing comma. Be tolerant
        // outside strings after the comment-safe pass above.
        out = out.replace(/,\s*([}\]])/g, "$1");
        return JSON.parse(out);
    }

    function deepClone(value) {
        if (value == null || typeof value !== "object") return value;
        if (Array.isArray(value)) return value.map(deepClone);

        const out = {};
        for (const [k, v] of Object.entries(value)) out[k] = deepClone(v);
        return out;
    }

    function deepMerge(base, local) {
        if (base == null || typeof base !== "object") return deepClone(local);
        if (local == null || typeof local !== "object") return deepClone(base);
        if (Array.isArray(base) || Array.isArray(local)) {
            return deepClone(local);
        }

        const out = deepClone(base);

        for (const [k, v] of Object.entries(local)) {
            if (
                v &&
                typeof v === "object" &&
                !Array.isArray(v) &&
                out[k] &&
                typeof out[k] === "object" &&
                !Array.isArray(out[k])
            ) {
                out[k] = deepMerge(out[k], v);
            } else {
                out[k] = deepClone(v);
            }
        }

        return out;
    }

    function normalizeRef(ref) {
        const text = String(ref || "").trim();
        if (!text) return null;

        const split = text.split(".");
        if (split.length < 2) {
            return {
                namespace: STATE.namespace,
                key: split[0],
            };
        }

        return {
            namespace: split.shift(),
            key: split.join("."),
        };
    }

    function getLocalDefinition(ref) {
        const info = normalizeRef(ref);
        if (!info || !STATE.parsed) return null;

        // Only local definitions can be resolved. External common.* references
        // remain as generic controls, rather than killing the import.
        if (
            info.namespace !== STATE.namespace &&
            info.namespace !== STATE.parsed.namespace
        ) {
            return null;
        }

        return STATE.parsed[info.key] ?? null;
    }

    function splitControlKey(key) {
        const text = String(key || "");
        const at = text.indexOf("@");

        if (at === -1) {
            return { name: text, reference: null };
        }

        return {
            name: text.slice(0, at),
            reference: text.slice(at + 1),
        };
    }

    function buildVars(obj, parentVars = {}) {
        const vars = { ...parentVars };

        if (!obj || typeof obj !== "object") return vars;

        for (const [key, value] of Object.entries(obj)) {
            if (!key.startsWith("$")) continue;

            const clean = key.split("|")[0];
            vars[clean] = value;
        }

        const variables = obj.variables;
        if (Array.isArray(variables)) {
            for (const variable of variables) {
                if (!variable || typeof variable !== "object") continue;

                for (const [key, value] of Object.entries(variable)) {
                    if (key.startsWith("$")) vars[key.split("|")[0]] = value;
                }
            }
        }

        return vars;
    }

    function resolveVar(value, vars, depth = 0) {
        if (depth > 12) return value;

        if (typeof value === "string" && value.startsWith("$")) {
            const base = value.split("|")[0];
            if (Object.prototype.hasOwnProperty.call(vars, base)) {
                return resolveVar(vars[base], vars, depth + 1);
            }
        }

        if (Array.isArray(value)) {
            return value.map((v) => resolveVar(v, vars, depth + 1));
        }

        return value;
    }

    function prepareControl(rawKey, rawValue, parentVars = {}, stack = new Set()) {
        const { name, reference } = splitControlKey(rawKey);
        let merged = rawValue && typeof rawValue === "object"
            ? deepClone(rawValue)
            : {};

        if (reference && !stack.has(reference)) {
            const base = getLocalDefinition(reference);

            if (base && typeof base === "object") {
                const nextStack = new Set(stack);
                nextStack.add(reference);
                merged = deepMerge(base, merged);
            }
        }

        const vars = buildVars(merged, parentVars);

        return {
            name,
            reference,
            json: merged,
            vars,
        };
    }

    function inferType(name, json, reference) {
        const explicit = String(json?.type || "").toLowerCase();
        if (CONTROL_TYPES.has(explicit)) return explicit;

        const haystack = `${name || ""} ${reference || ""}`.toLowerCase();

        if (
            json?.texture !== undefined ||
            json?.texture_file_system !== undefined
        ) {
            return "image";
        }

        if (
            json?.text !== undefined &&
            !Array.isArray(json?.controls)
        ) {
            return "label";
        }

        if (
            json?.collection_name !== undefined ||
            json?.collection_index !== undefined
        ) {
            return "collection_panel";
        }

        if (
            haystack.includes("button") ||
            json?.$default_button_texture !== undefined ||
            json?.$default_button_background_texture !== undefined ||
            json?.pressed_button_name !== undefined ||
            json?.$pressed_button_name !== undefined
        ) {
            return "button";
        }

        if (haystack.includes("image")) return "image";
        if (haystack.includes("label") || haystack.includes("text")) return "label";
        if (haystack.includes("stack")) return "stack_panel";
        if (haystack.includes("grid")) return "grid";

        return "panel";
    }

    function resolveScalar(value, vars) {
        value = resolveVar(value, vars);

        if (typeof value === "number" && Number.isFinite(value)) return value;

        if (typeof value === "string") {
            const trimmed = value.trim();
            const direct = Number(trimmed.replace(/px$/i, ""));
            if (Number.isFinite(direct)) return direct;
        }

        return null;
    }

    function editorScalar() {
        return Number(STATE.modules?.config?.magicNumbers?.UI_SCALAR) || 0.36;
    }

    function dimToPx(value, parentPx, vars, fallbackPx = 100) {
        value = resolveVar(value, vars);

        if (typeof value === "number" && Number.isFinite(value)) {
            return value / editorScalar();
        }

        if (typeof value !== "string") return fallbackPx;

        let text = value.trim().toLowerCase();
        if (!text || text === "default") return fallbackPx;

        // Content-size suffix used by Bedrock. We cannot know content measure
        // before rendering, so use the parent's dimension as a stable preview.
        text = text.replace(/%c/g, "%");

        // Resolve a variable embedded as the whole expression.
        if (text.startsWith("$") && vars[text] !== undefined) {
            return dimToPx(vars[text], parentPx, vars, fallbackPx);
        }

        // Basic Bedrock expressions: "100% - 15px", "50% + 2".
        const expr = text.match(
            /^(-?\d+(?:\.\d+)?)%\s*([+-])?\s*(-?\d+(?:\.\d+)?)?(?:px)?$/
        );

        if (expr) {
            let result = parentPx * (Number(expr[1]) / 100);

            if (expr[2] && expr[3] !== undefined) {
                const delta = Number(expr[3]) / editorScalar();
                result += expr[2] === "+" ? delta : -delta;
            }

            return result;
        }

        const percent = text.match(/^(-?\d+(?:\.\d+)?)%$/);
        if (percent) {
            return parentPx * (Number(percent[1]) / 100);
        }

        const px = text.match(/^(-?\d+(?:\.\d+)?)px$/);
        if (px) {
            return Number(px[1]) / editorScalar();
        }

        const number = Number(text);
        if (Number.isFinite(number)) return number / editorScalar();

        return fallbackPx;
    }

    function pairToPx(value, parentW, parentH, vars, fallback = [0, 0]) {
        value = resolveVar(value, vars);

        if (!Array.isArray(value)) return [...fallback];

        return [
            dimToPx(value[0], parentW, vars, fallback[0]),
            dimToPx(value[1], parentH, vars, fallback[1]),
        ];
    }

    const ANCHORS = {
        top_left: [0, 0],
        top_middle: [0.5, 0],
        top_right: [1, 0],
        left_middle: [0, 0.5],
        center: [0.5, 0.5],
        right_middle: [1, 0.5],
        bottom_left: [0, 1],
        bottom_middle: [0.5, 1],
        bottom_right: [1, 1],
    };

    function anchorVector(name) {
        return ANCHORS[String(name || "").toLowerCase()] || ANCHORS.center;
    }

    function applyGeometry(element, json, vars, parentElement, defaultSize = [120, 80]) {
        const parentRect = parentElement.getBoundingClientRect();
        const parentW = parentRect.width || 1500;
        const parentH = parentRect.height || 844;

        const size = pairToPx(
            json?.size,
            parentW,
            parentH,
            vars,
            defaultSize
        );

        const width = Math.max(1, size[0]);
        const height = Math.max(1, size[1]);

        const offset = pairToPx(
            json?.offset,
            parentW,
            parentH,
            vars,
            [0, 0]
        );

        const to = anchorVector(
            resolveVar(json?.anchor_to, vars) || "center"
        );

        const from = anchorVector(
            resolveVar(json?.anchor_from, vars) ||
            resolveVar(json?.anchor_to, vars) ||
            "center"
        );

        const left =
            parentW * to[0] +
            offset[0] -
            width * from[0];

        const top =
            parentH * to[1] +
            offset[1] -
            height * from[1];

        element.style.width = `${width}px`;
        element.style.height = `${height}px`;
        element.style.left = `${left}px`;
        element.style.top = `${top}px`;

        const layer = resolveScalar(json?.layer, vars);
        if (layer !== null) element.style.zIndex = String(layer);

        return { width, height, left, top };
    }

    function normalizeTexturePath(value, vars) {
        value = resolveVar(value, vars);

        if (typeof value !== "string") return null;

        let path = value.trim();

        if (
            !path ||
            path.startsWith("$") ||
            path.startsWith("#") ||
            path === "loading" ||
            path.includes("(") ||
            path.includes(")")
        ) {
            return null;
        }

        path = path
            .replace(/^textures\//i, "")
            .replace(/\.(png|jpg|jpeg|webp|tga)$/i, "")
            .replace(/^\/+/, "");

        return path || null;
    }

    function createFallbackImageData(label = "missing") {
        const existing = STATE.modules?.index?.images?.get("assets/placeholder")?.png;
        if (existing) return existing;

        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 128;

        const ctx = canvas.getContext("2d", { willReadFrequently: true });

        for (let y = 0; y < 128; y += 16) {
            for (let x = 0; x < 128; x += 16) {
                ctx.fillStyle =
                    ((x / 16 + y / 16) % 2 === 0)
                        ? "#d100d1"
                        : "#1c1c1c";

                ctx.fillRect(x, y, 16, 16);
            }
        }

        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(18, 18);
        ctx.lineTo(110, 110);
        ctx.moveTo(110, 18);
        ctx.lineTo(18, 110);
        ctx.stroke();

        ctx.fillStyle = "rgba(0,0,0,.82)";
        ctx.fillRect(0, 94, 128, 34);

        ctx.fillStyle = "#fff";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(
            String(label).split("/").pop().slice(0, 18),
            64,
            114
        );

        return ctx.getImageData(0, 0, 128, 128);
    }

    function ensureTexture(path) {
        if (!path) path = "__rag/fallback";

        const images = STATE.modules.index.images;

        if (images.has(path) && images.get(path)?.png) {
            return {
                path,
                missing: STATE.fallbackPaths.has(path),
            };
        }

        images.set(path, {
            png: createFallbackImageData(path),
            __ragFallback: true,
        });

        STATE.fallbackPaths.add(path);

        return {
            path,
            missing: true,
        };
    }

    function scanTextureRefs(node, vars = {}, seen = new WeakSet()) {
        if (!node || typeof node !== "object") return;

        if (seen.has(node)) return;
        seen.add(node);

        if (Array.isArray(node)) {
            for (const item of node) scanTextureRefs(item, vars, seen);
            return;
        }

        const localVars = buildVars(node, vars);

        for (const [key, value] of Object.entries(node)) {
            if (
                typeof value === "string" &&
                /texture/i.test(key)
            ) {
                const path = normalizeTexturePath(value, localVars);
                if (path) ensureTexture(path);
            }

            if (value && typeof value === "object") {
                scanTextureRefs(value, localVars, seen);
            }
        }
    }

    function getRootClass() {
        const rootEl = STATE.modules.config.rootElement;
        if (!rootEl) return null;
        return STATE.modules.index.GLOBAL_ELEMENT_MAP.get(rootEl.dataset.id) || null;
    }

    function makeId() {
        if (crypto.randomUUID) {
            return crypto.randomUUID().replace(/-/g, "").slice(0, 15);
        }

        return Math.random().toString(36).slice(2, 17);
    }

    function saveRaw(instance, raw) {
        const element = instance?.getMainHTMLElement?.();
        const id = element?.dataset?.id;
        if (id) STATE.rawByElementId.set(id, raw);
    }

    function bindingsToString(json) {
        if (!Array.isArray(json?.bindings) || !json.bindings.length) return "";
        return JSON.stringify(json.bindings, null, 4);
    }

    function createPanel(parentClass, json, vars, raw) {
        const id = makeId();
        const panel = new STATE.modules.DraggablePanel(
            id,
            parentClass.getMainHTMLElement()
        );

        STATE.modules.index.GLOBAL_ELEMENT_MAP.set(id, panel);

        applyGeometry(
            panel.panel,
            json,
            vars,
            parentClass.getMainHTMLElement(),
            [220, 140]
        );

        panel.bindings = bindingsToString(json);

        // Give imported generic controls a subtle tint only when the source
        // explicitly contains a color. Otherwise keep normal transparency.
        const color = resolveVar(json?.color, vars);
        if (
            Array.isArray(color) &&
            color.length >= 3 &&
            color.every((n) => typeof n === "number")
        ) {
            panel.panel.style.backgroundColor =
                `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
        }

        saveRaw(panel, raw);
        return panel;
    }

    function createCollection(parentClass, json, vars, raw) {
        const id = makeId();

        const panel = new STATE.modules.DraggableCollectionPanel(
            id,
            parentClass.getMainHTMLElement()
        );

        STATE.modules.index.GLOBAL_ELEMENT_MAP.set(id, panel);

        applyGeometry(
            panel.panel,
            json,
            vars,
            parentClass.getMainHTMLElement(),
            [220, 140]
        );

        panel.panel.dataset.collectionName =
            String(resolveVar(json?.collection_name, vars) || "form_buttons");

        panel.bindings = bindingsToString(json);
        saveRaw(panel, raw);
        return panel;
    }

    function createImage(parentClass, json, vars, raw) {
        const textureValue =
            json?.texture ??
            json?.$texture ??
            json?.$default_texture ??
            json?.$default_button_texture ??
            json?.$default_button_background_texture;

        const requested =
            normalizeTexturePath(textureValue, vars) ||
            "__rag/fallback";

        const texture = ensureTexture(requested);
        const state = STATE.modules.index.images.get(texture.path);

        const id = makeId();

        const canvas = new STATE.modules.DraggableCanvas(
            id,
            parentClass.getMainHTMLElement(),
            state.png,
            texture.path,
            state.json
        );

        STATE.modules.index.GLOBAL_ELEMENT_MAP.set(id, canvas);

        const geom = applyGeometry(
            canvas.canvasHolder,
            json,
            vars,
            parentClass.getMainHTMLElement(),
            [160, 100]
        );

        canvas.drawImage(geom.width, geom.height, false);
        canvas.bindings = bindingsToString(json);

        canvas.canvasHolder.dataset.ragKeepAspect = "false";

        if (texture.missing) {
            canvas.canvasHolder.dataset.ragMissingTexture = requested;
            canvas.canvasHolder.dataset.ragFallbackActive = "true";
        }

        saveRaw(canvas, raw);
        return canvas;
    }

    function createLabel(parentClass, json, vars, raw) {
        const id = makeId();

        const rawText = resolveVar(json?.text, vars);
        const text =
            typeof rawText === "string"
                ? rawText
                : rawText == null
                    ? "Label"
                    : JSON.stringify(rawText);

        const scale =
            resolveScalar(json?.font_scale_factor, vars) ??
            resolveScalar(json?.font_size, vars) ??
            1;

        const label = new STATE.modules.DraggableLabel(
            id,
            parentClass.getMainHTMLElement(),
            {
                text,
                includeTextPrompt: true,
                fontScale: Math.max(0.1, scale / editorScalar()),
                textAlign:
                    resolveVar(json?.text_alignment, vars) ||
                    "left",
            }
        );

        STATE.modules.index.GLOBAL_ELEMENT_MAP.set(id, label);

        const parentEl = parentClass.getMainHTMLElement();
        const parentRect = parentEl.getBoundingClientRect();

        const offset = pairToPx(
            json?.offset,
            parentRect.width,
            parentRect.height,
            vars,
            [0, 0]
        );

        const width =
            label.label.getBoundingClientRect().width || 80;
        const height =
            label.label.getBoundingClientRect().height || 24;

        const to = anchorVector(
            resolveVar(json?.anchor_to, vars) || "center"
        );

        const from = anchorVector(
            resolveVar(json?.anchor_from, vars) ||
            resolveVar(json?.anchor_to, vars) ||
            "center"
        );

        label.label.style.left =
            `${parentRect.width * to[0] + offset[0] - width * from[0]}px`;

        label.label.style.top =
            `${parentRect.height * to[1] + offset[1] - height * from[1]}px`;

        const fontType = resolveVar(json?.font_type, vars);
        if (typeof fontType === "string" && fontType) {
            label.label.style.fontFamily = fontType;
            label.mirror.style.fontFamily = fontType;
            label.shadowLabel.style.fontFamily = fontType;
        }

        if (json?.shadow !== undefined) {
            label.shadow(Boolean(resolveVar(json.shadow, vars)));
        }

        label.bindings = bindingsToString(json);
        label.updateSize(false);
        saveRaw(label, raw);
        return label;
    }

    function buttonTexture(json, vars, keys) {
        for (const key of keys) {
            const path = normalizeTexturePath(json?.[key], vars);
            if (path) return ensureTexture(path).path;
        }

        return ensureTexture("__rag/button_fallback").path;
    }

    function createButton(parentClass, json, vars, raw) {
        const defaultTexture = buttonTexture(json, vars, [
            "$default_button_background_texture",
            "$default_button_texture",
            "default_texture",
            "texture",
        ]);

        const hoverTexture = buttonTexture(json, vars, [
            "$hover_button_background_texture",
            "$hover_button_texture",
            "hover_texture",
        ]);

        const pressedTexture = buttonTexture(json, vars, [
            "$pressed_button_background_texture",
            "$pressed_button_texture",
            "pressed_texture",
        ]);

        const id = makeId();

        const button = new STATE.modules.DraggableButton(
            id,
            parentClass.getMainHTMLElement(),
            {
                defaultTexture,
                hoverTexture,
                pressedTexture,
                buttonText:
                    String(
                        resolveVar(json?.$button_text, vars) ||
                        resolveVar(json?.text, vars) ||
                        "Button"
                    ),
                collectionIndex:
                    String(
                        resolveVar(json?.collection_index, vars) ??
                        0
                    ),
            }
        );

        STATE.modules.index.GLOBAL_ELEMENT_MAP.set(id, button);

        const proxy = {
            ...json,
            size:
                resolveVar(json?.$button_size, vars) ??
                json?.size,
            offset:
                resolveVar(json?.$button_offset, vars) ??
                json?.offset,
        };

        const geom = applyGeometry(
            button.button,
            proxy,
            vars,
            parentClass.getMainHTMLElement(),
            [180, 54]
        );

        button.drawImage(
            geom.width,
            geom.height,
            button.imageDataDefault
        );

        button.bindings = bindingsToString(json);
        saveRaw(button, raw);
        return button;
    }

    function createControl(parentClass, rawKey, rawValue, parentVars, stack) {
        const prepared = prepareControl(
            rawKey,
            rawValue,
            parentVars,
            stack
        );

        const type = inferType(
            prepared.name,
            prepared.json,
            prepared.reference
        );

        let instance;

        try {
            if (type === "image") {
                instance = createImage(
                    parentClass,
                    prepared.json,
                    prepared.vars,
                    rawValue
                );
            } else if (type === "label") {
                instance = createLabel(
                    parentClass,
                    prepared.json,
                    prepared.vars,
                    rawValue
                );
            } else if (type === "collection_panel") {
                instance = createCollection(
                    parentClass,
                    prepared.json,
                    prepared.vars,
                    rawValue
                );
            } else if (type === "button") {
                instance = createButton(
                    parentClass,
                    prepared.json,
                    prepared.vars,
                    rawValue
                );
            } else {
                // stack_panel, grid, factory, custom, external inherited
                // controls etc. are still represented and remain traversable.
                instance = createPanel(
                    parentClass,
                    prepared.json,
                    prepared.vars,
                    rawValue
                );

                instance.getMainHTMLElement().dataset.ragImportedType = type;
                if (!CONTROL_TYPES.has(type)) {
                    instance.getMainHTMLElement().dataset.ragImportedType =
                        "unknown";
                }
            }
        } catch (error) {
            console.warn(
                "[Universal JSON UI] Control fallback:",
                rawKey,
                error
            );

            instance = createPanel(
                parentClass,
                {
                    type: "panel",
                    size: prepared.json?.size || [100, 60],
                    offset: prepared.json?.offset || [0, 0],
                    layer: prepared.json?.layer || 0,
                },
                prepared.vars,
                rawValue
            );

            instance.getMainHTMLElement().dataset.ragImportedType =
                "fallback";
        }

        const json = prepared.json || {};

        if (Array.isArray(json.controls)) {
            renderControls(
                json.controls,
                instance,
                prepared.vars,
                stack
            );
        }

        // Follow local scrolling/content references if present.
        for (const refKey of [
            "$scrolling_content",
            "$child_control",
            "$content",
        ]) {
            const refValue = resolveVar(json?.[refKey], prepared.vars);

            if (typeof refValue !== "string") continue;

            const refObject = getLocalDefinition(refValue);
            if (!refObject) continue;

            const info = normalizeRef(refValue);
            if (!info || stack.has(refValue)) continue;

            const nextStack = new Set(stack);
            nextStack.add(refValue);

            if (Array.isArray(refObject.controls)) {
                renderControls(
                    refObject.controls,
                    instance,
                    buildVars(refObject, prepared.vars),
                    nextStack
                );
            } else {
                createControl(
                    instance,
                    info.key,
                    refObject,
                    prepared.vars,
                    nextStack
                );
            }
        }

        return instance;
    }

    function renderControls(controls, parentClass, parentVars, stack = new Set()) {
        if (!Array.isArray(controls)) return;

        for (const child of controls) {
            if (!child || typeof child !== "object") continue;

            const entries = Object.entries(child);
            if (!entries.length) continue;

            for (const [key, value] of entries) {
                createControl(
                    parentClass,
                    key,
                    value,
                    parentVars,
                    stack
                );
            }
        }
    }

    function candidateScore(key, value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            return -999;
        }

        if (key === "config" || key === "namespace") return -999;

        let score = 0;
        const name = key.toLowerCase();

        if (key === STATE.namespace) score += 120;
        if (Array.isArray(value.controls)) score += 50;
        if (typeof value.type === "string") score += 30;
        if (/(root|screen|main|form|content|hud|dialog)/.test(name)) score += 20;
        if (/custom_button|template|prototype/.test(name)) score -= 20;

        return score;
    }

    function discoverRoots(parsed) {
        const keys = Object.keys(parsed)
            .filter((key) => candidateScore(key, parsed[key]) > -999)
            .sort(
                (a, b) =>
                    candidateScore(b, parsed[b]) -
                    candidateScore(a, parsed[a])
            );

        return keys;
    }

    function rootToolsContainer() {
        let box = document.querySelector(".rag-json-root-tools");

        if (box) return box;

        const host =
            document.querySelector(".utilElements") ||
            document.querySelector(".buttons");

        if (!host) return null;

        box = document.createElement("div");
        box.className = "rag-json-root-tools";
        host.appendChild(box);
        return box;
    }

    function refreshRootSelector() {
        const box = rootToolsContainer();
        if (!box) return;

        box.innerHTML = "";

        if (!STATE.parsed || STATE.rootKeys.length <= 1) {
            box.style.display = "none";
            return;
        }

        box.style.display = "block";

        const label = document.createElement("div");
        label.className = "rag-json-root-title";
        label.textContent = "JSON ROOT";

        const select = document.createElement("select");
        select.className = "rag-json-root-select";

        for (const key of STATE.rootKeys) {
            const option = document.createElement("option");
            option.value = key;
            option.textContent = key;
            option.selected = key === STATE.currentRoot;
            select.appendChild(option);
        }

        select.addEventListener("change", () => {
            renderRoot(select.value);
        });

        box.append(label, select);
    }

    function renderRoot(rootKey) {
        if (!STATE.parsed || !STATE.modules) return;

        const rootJson = STATE.parsed[rootKey];

        if (!rootJson || typeof rootJson !== "object") return;

        const Builder = STATE.modules.index.Builder;

        Builder.reset();
        STATE.modules.config.nameSpace = STATE.namespace;
        STATE.rawByElementId.clear();
        STATE.currentRoot = rootKey;

        const rootClass = getRootClass();
        if (!rootClass) {
            throw new Error("Root interno do editor nao foi criado.");
        }

        const rootVars = buildVars(rootJson, {});

        // If this definition is itself a renderable control, import it as
        // a child. Otherwise treat it as a container and import controls.
        const rootType = inferType(rootKey, rootJson, null);
        const hasRenderableIdentity =
            rootJson.type !== undefined ||
            rootJson.texture !== undefined ||
            rootJson.text !== undefined;

        if (hasRenderableIdentity) {
            createControl(
                rootClass,
                rootKey,
                rootJson,
                rootVars,
                new Set([`${STATE.namespace}.${rootKey}`])
            );
        } else if (Array.isArray(rootJson.controls)) {
            renderControls(
                rootJson.controls,
                rootClass,
                rootVars,
                new Set([`${STATE.namespace}.${rootKey}`])
            );
        } else {
            // Even a bare definition is displayed rather than rejected.
            createControl(
                rootClass,
                rootKey,
                rootJson,
                rootVars,
                new Set([`${STATE.namespace}.${rootKey}`])
            );
        }

        Builder.updateExplorer();
        refreshRootSelector();

        showImportBanner(
            `JSON aberto: ${rootKey} | ${STATE.rootKeys.length} definicao(oes) | ${STATE.fallbackPaths.size} textura(s) em fallback`,
            "success"
        );
    }

    function showImportBanner(message, kind = "normal") {
        let banner = document.querySelector(".rag-universal-import-banner");

        if (!banner) {
            banner = document.createElement("div");
            banner.className = "rag-universal-import-banner";
            document.body.appendChild(banner);
        }

        banner.textContent = message;
        banner.dataset.kind = kind;
        banner.classList.add("show");

        clearTimeout(showImportBanner.timer);
        showImportBanner.timer = setTimeout(() => {
            banner.classList.remove("show");
        }, kind === "error" ? 6000 : 3500);
    }

    async function universalImport(raw, fileName) {
        const parsed = parseJsonc(raw);

        if (
            !parsed ||
            typeof parsed !== "object" ||
            Array.isArray(parsed)
        ) {
            throw new Error("O arquivo nao contem um objeto JSON UI.");
        }

        STATE.parsed = parsed;
        STATE.fileName = fileName || "imported.json";
        STATE.namespace = sanitizeNamespace(
            parsed.namespace || stripExtension(fileName)
        );

        parsed.namespace = parsed.namespace || STATE.namespace;

        STATE.fallbackPaths.clear();

        // Scan before reset/render so missing textures already exist under
        // their ORIGINAL path when element constructors request them.
        scanTextureRefs(parsed);

        STATE.rootKeys = discoverRoots(parsed);

        if (!STATE.rootKeys.length) {
            // Last-resort root. This also accepts JSON whose top level is
            // itself effectively a control object.
            const syntheticKey = "__imported_root";
            parsed[syntheticKey] = {
                type: "panel",
                size: ["100%", "100%"],
                controls: Object.entries(parsed)
                    .filter(([key, value]) =>
                        key !== "namespace" &&
                        key !== "config" &&
                        value &&
                        typeof value === "object" &&
                        !Array.isArray(value)
                    )
                    .map(([key, value]) => ({ [key]: value })),
            };

            STATE.rootKeys = [syntheticKey];
        }

        STATE.currentRoot = STATE.rootKeys[0];
        renderRoot(STATE.currentRoot);
    }

    async function fileToImageData(file) {
        const url = URL.createObjectURL(file);

        try {
            const image = new Image();

            await new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = () => reject(
                    new Error("Nao foi possivel abrir a imagem.")
                );
                image.src = url;
            });

            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth || image.width;
            canvas.height = image.naturalHeight || image.height;

            const ctx = canvas.getContext("2d", {
                willReadFrequently: true,
            });

            ctx.drawImage(image, 0, 0);

            return ctx.getImageData(
                0,
                0,
                canvas.width,
                canvas.height
            );
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    function fileToDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(
                reader.error || new Error("Falha ao ler arquivo.")
            );
            reader.readAsDataURL(file);
        });
    }

    function persistTexture(path, file, dataUrl) {
        try {
            localStorage.setItem(
                `asset_${path}_png`,
                JSON.stringify({
                    base64: dataUrl,
                    metadata: {
                        name: file.name,
                        type: "png",
                        relativePath: `textures/${path}.png`,
                        importedForJsonPath: true,
                        loadedAt: new Date().toISOString(),
                    },
                })
            );
        } catch (error) {
            console.warn(
                "[Universal JSON UI] Falha ao persistir textura:",
                error
            );
        }
    }

    function preserveCanvasGeometry(instance, action) {
        const el = instance.canvasHolder;

        const geometry = {
            width:
                parseFloat(el.style.width) ||
                el.getBoundingClientRect().width ||
                1,
            height:
                parseFloat(el.style.height) ||
                el.getBoundingClientRect().height ||
                1,
            left: el.style.left,
            top: el.style.top,
            zIndex: el.style.zIndex,
            keepAspect: el.dataset.ragKeepAspect,
        };

        action();

        // Re-apply exact visual footprint after source pixels change.
        instance.drawImage(
            geometry.width,
            geometry.height,
            false
        );

        el.style.left = geometry.left;
        el.style.top = geometry.top;
        el.style.zIndex = geometry.zIndex;

        if (geometry.keepAspect !== undefined) {
            el.dataset.ragKeepAspect = geometry.keepAspect;
        }

        return geometry;
    }

    function patchTextureReplacement() {
        const Canvas = STATE.modules.DraggableCanvas;

        if (
            Canvas.prototype.__ragPreserveTextureGeometry
        ) {
            return;
        }

        Canvas.prototype.__ragPreserveTextureGeometry = true;

        const original = Canvas.prototype.changeImage;

        Canvas.prototype.changeImage = function (imagePath) {
            const state = STATE.modules.index.images.get(imagePath);
            if (!state?.png) return;

            preserveCanvasGeometry(this, () => {
                original.call(this, imagePath);
            });

            this.canvasHolder.dataset.imagePath = imagePath;
            this.canvasHolder.dataset.ragFallbackActive =
                STATE.fallbackPaths.has(imagePath)
                    ? "true"
                    : "false";

            if (!STATE.fallbackPaths.has(imagePath)) {
                delete this.canvasHolder.dataset.ragMissingTexture;
            }
        };
    }

    function patchCanvasPropertySizing() {
        const props = STATE.modules.propertiesMap?.get(
            "draggable-canvas"
        );

        if (!Array.isArray(props)) return;
        if (props.__ragFreeSizingPatched) return;

        props.__ragFreeSizingPatched = true;

        const width = props.find((p) => p.displayName === "Width");
        const height = props.find((p) => p.displayName === "Height");
        const fill = props.find((p) => p.displayName === "Fill Parent");

        if (width) {
            width.set = (element, value) => {
                const instance =
                    STATE.modules.index.GLOBAL_ELEMENT_MAP.get(
                        element.dataset.id
                    );

                if (!instance) return;

                const newWidth = Math.max(1, parseFloat(value) || 1);
                const currentHeight =
                    parseFloat(instance.canvasHolder.style.height) ||
                    instance.canvasHolder.getBoundingClientRect().height ||
                    1;

                if (
                    instance.canvasHolder.dataset.ragKeepAspect === "true" &&
                    !instance.nineSlice
                ) {
                    instance.drawImage(
                        newWidth,
                        newWidth / instance.aspectRatio,
                        false
                    );
                } else {
                    instance.drawImage(
                        newWidth,
                        currentHeight,
                        false
                    );
                }
            };
        }

        if (height) {
            height.set = (element, value) => {
                const instance =
                    STATE.modules.index.GLOBAL_ELEMENT_MAP.get(
                        element.dataset.id
                    );

                if (!instance) return;

                const newHeight = Math.max(1, parseFloat(value) || 1);
                const currentWidth =
                    parseFloat(instance.canvasHolder.style.width) ||
                    instance.canvasHolder.getBoundingClientRect().width ||
                    1;

                if (
                    instance.canvasHolder.dataset.ragKeepAspect === "true" &&
                    !instance.nineSlice
                ) {
                    instance.drawImage(
                        newHeight * instance.aspectRatio,
                        newHeight,
                        false
                    );
                } else {
                    instance.drawImage(
                        currentWidth,
                        newHeight,
                        false
                    );
                }
            };
        }

        if (fill) {
            fill.set = (element) => {
                const instance =
                    STATE.modules.index.GLOBAL_ELEMENT_MAP.get(
                        element.dataset.id
                    );

                if (!instance) return;

                const parent = instance.container;
                const rect = parent.getBoundingClientRect();

                instance.canvasHolder.style.left = "0px";
                instance.canvasHolder.style.top = "0px";
                instance.drawImage(rect.width, rect.height, false);
            };
        }
    }

    async function loadTextureIntoExactPath(instance, path, file) {
        const [imageData, dataUrl] = await Promise.all([
            fileToImageData(file),
            fileToDataUrl(file),
        ]);

        STATE.modules.index.images.set(path, {
            png: imageData,
        });

        STATE.fallbackPaths.delete(path);
        persistTexture(path, file, dataUrl);

        instance.changeImage(path);
        instance.canvasHolder.dataset.ragFallbackActive = "false";
        delete instance.canvasHolder.dataset.ragMissingTexture;
    }

    function selectedCanvas() {
        const selected = STATE.modules.index.selectedElement;
        const id = selected?.dataset?.id;

        if (!id) return null;

        const instance =
            STATE.modules.index.GLOBAL_ELEMENT_MAP.get(id);

        return instance instanceof STATE.modules.DraggableCanvas
            ? instance
            : null;
    }

    function addTextureTools() {
        const properties = document.getElementById("properties");
        if (!properties) return;

        const instance = selectedCanvas();

        const old = properties.querySelector(
            ".rag-universal-texture-tools"
        );

        if (!instance) {
            old?.remove();
            return;
        }

        const elementId = instance.canvasHolder.dataset.id;

        if (old?.dataset?.elementId === elementId) {
            const state = old.querySelector(".rag-texture-state");
            if (state) {
                state.textContent =
                    instance.canvasHolder.dataset.ragFallbackActive === "true"
                        ? `FALLBACK ATIVO: textures/${instance.canvasHolder.dataset.imagePath}`
                        : `TEXTURA: textures/${instance.canvasHolder.dataset.imagePath}`;
            }
            return;
        }

        old?.remove();

        const box = document.createElement("div");
        box.className = "rag-universal-texture-tools";
        box.dataset.elementId = elementId || "";

        const state = document.createElement("div");
        state.className = "rag-texture-state";

        state.textContent =
            instance.canvasHolder.dataset.ragFallbackActive === "true"
                ? `FALLBACK ATIVO: textures/${instance.canvasHolder.dataset.imagePath}`
                : `TEXTURA: textures/${instance.canvasHolder.dataset.imagePath}`;

        const replace = document.createElement("button");
        replace.type = "button";
        replace.className = "propertyInputButton";
        replace.textContent = "TROCAR TEXTURA";

        replace.addEventListener("click", async () => {
            try {
                const path =
                    await STATE.modules.chooseImageModal();

                instance.changeImage(path);
                STATE.modules.updatePropertiesArea();
            } catch (_) {
                // picker closed
            }
        });

        const exact = document.createElement("button");
        exact.type = "button";
        exact.className =
            "propertyInputButton rag-load-exact-texture";
        exact.textContent =
            "CARREGAR ARQUIVO NESTE CAMINHO";

        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept =
            "image/png,image/jpeg,image/webp";
        fileInput.style.display = "none";

        exact.addEventListener("click", () => {
            fileInput.value = "";
            fileInput.click();
        });

        fileInput.addEventListener("change", async () => {
            const file = fileInput.files?.[0];
            if (!file) return;

            const path =
                instance.canvasHolder.dataset.imagePath ||
                instance.canvasHolder.dataset.ragMissingTexture;

            if (!path) return;

            exact.disabled = true;
            exact.textContent = "CARREGANDO...";

            try {
                await loadTextureIntoExactPath(
                    instance,
                    path,
                    file
                );

                state.textContent =
                    `TEXTURA: textures/${path}`;

                STATE.modules.updatePropertiesArea();
            } catch (error) {
                console.error(error);
                showImportBanner(
                    `Falha ao carregar textura: ${error?.message || error}`,
                    "error"
                );
            } finally {
                exact.disabled = false;
                exact.textContent =
                    "CARREGAR ARQUIVO NESTE CAMINHO";
            }
        });

        const hint = document.createElement("div");
        hint.className = "rag-texture-tool-hint";
        hint.textContent =
            "Trocar preserva tamanho e posicao. Carregar neste caminho substitui o fallback sem mudar o JSON.";

        box.append(
            state,
            replace,
            exact,
            fileInput,
            hint
        );

        properties.appendChild(box);
    }

    function observeProperties() {
        const properties = document.getElementById("properties");

        if (!properties) {
            setTimeout(observeProperties, 100);
            return;
        }

        if (properties.dataset.ragUniversalTextureObserver) return;
        properties.dataset.ragUniversalTextureObserver = "true";

        const observer = new MutationObserver(() => {
            queueMicrotask(addTextureTools);
        });

        observer.observe(properties, {
            childList: true,
            subtree: true,
        });

        document.addEventListener(
            "dblclick",
            () => setTimeout(addTextureTools, 0),
            true
        );

        document
            .getElementById("explorer")
            ?.addEventListener(
                "pointerup",
                () => setTimeout(addTextureTools, 0),
                true
            );
    }

    function installUniversalStyles() {
        if (document.getElementById("ragUniversalImportStyles")) return;

        const style = document.createElement("style");
        style.id = "ragUniversalImportStyles";
        style.textContent = `
.rag-json-root-tools {
    margin: 8px 5px;
    padding: 8px;
    border: 1px solid rgba(167,54,240,.45);
    border-radius: 7px;
    background: rgba(35,35,39,.75);
}

.rag-json-root-title {
    margin-bottom: 5px;
    color: #c96eff;
    font-size: 10px;
    font-weight: 900;
}

.rag-json-root-select {
    width: 100%;
    min-height: 34px;
    border: 1px solid #6f3c8c;
    border-radius: 6px;
    background: #242428;
    color: white;
}

.rag-universal-import-banner {
    position: fixed;
    left: 50%;
    top: 78px;
    z-index: 300000;
    max-width: calc(100vw - 30px);
    padding: 10px 14px;
    border: 1px solid #9a3bd0;
    border-radius: 9px;
    background: rgba(25,25,29,.96);
    color: #eee;
    font: 700 12px/1.35 sans-serif;
    opacity: 0;
    pointer-events: none;
    transform: translate(-50%, -14px);
    transition: .2s ease;
}

.rag-universal-import-banner.show {
    opacity: 1;
    transform: translate(-50%, 0);
}

.rag-universal-import-banner[data-kind="success"] {
    border-color: #3ebd68;
}

.rag-universal-import-banner[data-kind="error"] {
    border-color: #e34848;
    color: #ffaaaa;
}

.rag-universal-texture-tools {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid rgba(180,80,255,.35);
}

.rag-texture-state {
    margin-bottom: 7px;
    max-width: 100%;
    overflow-wrap: anywhere;
    color: #d987ff;
    font-size: 10px;
    font-weight: 800;
}

.rag-universal-texture-tools button {
    margin-right: 7px;
    margin-bottom: 7px;
}

.rag-load-exact-texture {
    background: linear-gradient(135deg,#314a6a,#522e76) !important;
}

.rag-texture-tool-hint {
    color: #999;
    font-size: 10px;
    line-height: 1.35;
}

[data-rag-fallback-active="true"] {
    outline-color: #d100d1 !important;
}

@media (pointer: coarse) {
    .rag-json-root-select {
        min-height: 45px;
    }

    .rag-universal-texture-tools button {
        min-height: 46px;
        padding: 8px 10px;
    }

    .rag-universal-import-banner {
        top: 145px;
    }
}
`;
        document.head.appendChild(style);
    }

    async function loadModules() {
        if (STATE.modules) return STATE.modules;

        const [
            index,
            configMod,
            panelMod,
            canvasMod,
            collectionMod,
            labelMod,
            buttonMod,
            propsMod,
            chooseMod,
        ] = await Promise.all([
            import("./dist/index.js"),
            import("./dist/CONFIG.js"),
            import("./dist/elements/panel.js"),
            import("./dist/elements/canvas.js"),
            import("./dist/elements/collectionPanel.js"),
            import("./dist/elements/label.js"),
            import("./dist/elements/button.js"),
            import("./dist/ui/propertiesArea.js"),
            import("./dist/ui/modals/chooseImage.js"),
        ]);

        STATE.modules = {
            index,
            config: configMod.config,
            DraggablePanel: panelMod.DraggablePanel,
            DraggableCanvas: canvasMod.DraggableCanvas,
            DraggableCollectionPanel:
                collectionMod.DraggableCollectionPanel,
            DraggableLabel: labelMod.DraggableLabel,
            DraggableButton: buttonMod.DraggableButton,
            propertiesMap: propsMod.propertiesMap,
            updatePropertiesArea:
                propsMod.updatePropertiesArea,
            chooseImageModal:
                chooseMod.chooseImageModal,
        };

        return STATE.modules;
    }

    async function installUniversalImporter() {
        if (STATE.installed) return;
        STATE.installed = true;

        installUniversalStyles();
        await loadModules();

        patchTextureReplacement();
        patchCanvasPropertySizing();
        observeProperties();

        const Builder = window.Builder;
        if (!Builder) {
            STATE.installed = false;
            setTimeout(installUniversalImporter, 50);
            return;
        }

        if (!Builder.__ragUniversalUploadInstalled) {
            Builder.__ragUniversalUploadInstalled = true;

            Builder.uploadForm = function () {
                const input =
                    document.getElementById("form_importer");

                const file = input?.files?.[0];
                if (!file) return;

                const reader = new FileReader();

                reader.onload = async () => {
                    try {
                        await universalImport(
                            String(reader.result || ""),
                            file.name
                        );
                    } catch (error) {
                        console.error(
                            "[Universal JSON UI]",
                            error
                        );

                        showImportBanner(
                            `Nao consegui interpretar o JSON: ${error?.message || error}`,
                            "error"
                        );
                    } finally {
                        input.value = "";
                    }
                };

                reader.onerror = () => {
                    showImportBanner(
                        "Falha ao ler o arquivo JSON.",
                        "error"
                    );

                    input.value = "";
                };

                reader.readAsText(file);
            };
        }

        console.log(
            "[Touch Patch] Universal JSON UI importer instalado."
        );
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            () => installUniversalImporter(),
            { once: true }
        );
    } else {
        installUniversalImporter();
    }
})();
