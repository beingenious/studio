#import <Cocoa/Cocoa.h>

static BOOL StudioCaptionContainsPoint(NSView *content, NSPoint location,
                                       CGFloat height) {
  NSPoint point = [content convertPoint:location fromView:nil];
  CGFloat top = content.isFlipped ? point.y : NSHeight(content.bounds) - point.y;
  if (top < 0 || top >= height || !NSPointInRect(point, content.bounds)) return NO;
  for (NSWindowButton kind = NSWindowCloseButton; kind <= NSWindowZoomButton; kind++) {
    NSButton *button = [content.window standardWindowButton:kind];
    if (!button || button.isHiddenOrHasHiddenAncestor) continue;
    NSPoint local = [button convertPoint:location fromView:nil];
    if (NSMouseInRect(local, button.bounds, button.isFlipped)) return NO;
  }
  NSView *hit = [content hitTest:point];
  if (!hit || !hit.mouseDownCanMoveWindow) return NO;

  // Electron's non-draggable exclusion views deliberately return nil from
  // hitTest:. Inspect their coverage as well as the view receiving the event.
  for (NSView *path = hit; path && path != content; path = path.superview) {
    for (NSView *sibling in path.superview.subviews) {
      if (sibling == path || sibling.isHiddenOrHasHiddenAncestor) continue;
      NSPoint local = [sibling convertPoint:location fromView:nil];
      if (!sibling.mouseDownCanMoveWindow &&
          NSMouseInRect(local, sibling.bounds, sibling.isFlipped)) return NO;
    }
  }
  return YES;
}
