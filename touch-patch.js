/**
 * JSON-UI Maker - Mobile Touch Patch
 * Adds touch/pen support without changing the original desktop mouse code.
 *
 * Strategy:
 * - Real mouse input is left untouched.
 * - Touch/pen drags are translated to the MouseEvents the current editor expects.
 * - A tap in the canvas triggers the editor's existing dblclick selection path.
 * - Explorer items can be selected with one tap.
 * - A mobile EDIT/NAVIGATE toggle lets users either manipulate elements or pan the page.
 */
(() => {
    "use strict";

    if (window.__JSON_UI_MAKER_TOUCH_PATCH__) return;
    window.__JSON_UI_MAKER_TOUCH_PATCH__ = true;

    const hasTouch = navigator.maxTouchPoints > 0 || window.matchMedia?.("(pointer: coarse)").matches;
    if (!hasTouch || !window.PointerEvent) return;

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

    const isEditableControl = (target) =>
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);

    function makeMouseEvent(type, pointerEvent, x = pointerEvent.clientX, y = pointerEvent.clientY) {
        const event = new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            detail: type === "dblclick" ? 2 : 1,
            screenX: pointerEvent.screenX,
            screenY: pointerEvent.screenY,
            clientX: x,
            clientY: y,
            ctrlKey: pointerEvent.ctrlKey,
            shiftKey: pointerEvent.shiftKey,
            altKey: pointerEvent.altKey,
            metaKey: pointerEvent.metaKey,
            button: 0,
            buttons: type === "mouseup" || type === "dblclick" ? 0 : 1,
        });
        syntheticMouseEvents.add(event);
        return event;
    }

    function dispatchMouse(target, type, pointerEvent, x = pointerEvent.clientX, y = pointerEvent.clientY) {
        if (!(target instanceof EventTarget)) return;
        target.dispatchEvent(makeMouseEvent(type, pointerEvent, x, y));
    }

    function blockCompatibilityMouse(event) {
        if (syntheticMouseEvents.has(event)) return;
        if (Date.now() > suppressCompatMouseUntil) return;
        if (!(event.target instanceof Node)) return;
        if (!mainWindow?.contains(event.target)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    ["mousedown", "mousemove", "mouseup", "click", "dblclick"].forEach((type) => {
        document.addEventListener(type, blockCompatibilityMouse, true);
    });

    function resetGesture() {
        if (downTarget instanceof Element && activePointerId !== null) {
            try {
                if (downTarget.hasPointerCapture?.(activePointerId)) {
                    downTarget.releasePointerCapture(activePointerId);
                }
            } catch (_) {
                // Pointer capture can already be gone after cancellation/removal.
            }
        }
        activePointerId = null;
        downTarget = null;
        dragStarted = false;
    }

    function beginSyntheticDrag(event) {
        if (dragStarted || !(downTarget instanceof EventTarget)) return;
        dragStarted = true;
        suppressCompatMouseUntil = Date.now() + COMPAT_MOUSE_BLOCK_MS;
        dispatchMouse(downTarget, "mousedown", event, downX, downY);
    }

    function onPointerDown(event) {
        if (!editMode || event.pointerType === "mouse") return;
        if (activePointerId !== null) return; // one-finger editing; extra fingers are ignored
        if (!(event.target instanceof Node) || !mainWindow?.contains(event.target)) return;

        activePointerId = event.pointerId;
        downTarget = event.target;
        downX = lastX = event.clientX;
        downY = lastY = event.clientY;
        dragStarted = false;

        if (downTarget instanceof Element) {
            try {
                downTarget.setPointerCapture?.(event.pointerId);
            } catch (_) {
                // Some elements/browsers reject capture; document listeners still keep this working.
            }
        }

        // Non-editable canvas elements don't need native touch mouse compatibility.
        // Editable labels are allowed to keep their normal tap/focus behavior until a drag really starts.
        if (!isEditableControl(event.target)) {
            suppressCompatMouseUntil = Date.now() + COMPAT_MOUSE_BLOCK_MS;
            event.preventDefault();
        }
    }

    function onPointerMove(event) {
        if (event.pointerType === "mouse" || event.pointerId !== activePointerId || !(downTarget instanceof EventTarget)) return;

        lastX = event.clientX;
        lastY = event.clientY;
        const distance = Math.hypot(lastX - downX, lastY - downY);

        if (!dragStarted && distance >= DRAG_THRESHOLD) {
            beginSyntheticDrag(event);
        }

        if (!dragStarted) return;

        event.preventDefault();
        dispatchMouse(downTarget, "mousemove", event, lastX, lastY);
    }

    function onPointerUp(event) {
        if (event.pointerType === "mouse" || event.pointerId !== activePointerId) return;

        const target = downTarget;
        const wasDrag = dragStarted;
        const distance = Math.hypot(event.clientX - downX, event.clientY - downY);

        if (wasDrag && target instanceof EventTarget) {
            event.preventDefault();
            dispatchMouse(target, "mouseup", event, event.clientX, event.clientY);
        } else if (distance < DRAG_THRESHOLD && target instanceof Element) {
            // Mobile equivalent of the desktop editor's double-click selection.
            // Do not steal the native tap from textarea labels, so the keyboard/caret can still work.
            if (!target.closest(".resize-handle")) {
                queueMicrotask(() => dispatchMouse(target, "dblclick", event, event.clientX, event.clientY));
            }
        }

        resetGesture();
    }

    function onPointerCancel(event) {
        if (event.pointerType === "mouse" || event.pointerId !== activePointerId) return;
        if (dragStarted && downTarget instanceof EventTarget) {
            dispatchMouse(downTarget, "mouseup", event, lastX, lastY);
        }
        resetGesture();
    }

    function onExplorerPointerUp(event) {
        if (!editMode || event.pointerType === "mouse") return;
        if (!(event.target instanceof Element)) return;
        const explorerText = event.target.closest(".explorerText");
        if (!explorerText) return;
        // Existing ExplorerController uses ondblclick; map one mobile tap to that path.
        dispatchMouse(explorerText, "dblclick", event, event.clientX, event.clientY);
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
            if (!editMode && activePointerId !== null) resetGesture();
            render();
        });

        render();
        document.body.appendChild(button);
    }

    function init() {
        mainWindow = document.getElementById("main_window");
        if (!mainWindow) return;

        installStyles();
        installModeToggle();

        document.addEventListener("pointerdown", onPointerDown, { capture: true, passive: false });
        document.addEventListener("pointermove", onPointerMove, { capture: true, passive: false });
        document.addEventListener("pointerup", onPointerUp, { capture: true, passive: false });
        document.addEventListener("pointercancel", onPointerCancel, { capture: true, passive: false });

        const explorer = document.getElementById("explorer");
        explorer?.addEventListener("pointerup", onExplorerPointerUp, { passive: true });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
