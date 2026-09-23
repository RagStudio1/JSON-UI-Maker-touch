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
