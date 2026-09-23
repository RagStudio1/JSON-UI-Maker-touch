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
        if (!editMode || event.pointerType === "mouse") return;
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
            event.preventDefault();
        }
    }

    function onPointerMove(event) {
        if (
            event.pointerType === "mouse" ||
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
    body.jsonui-touch-edit #main_window {
        touch-action: none !important;
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
