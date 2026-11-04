#import <Cocoa/Cocoa.h>
#include <assert.h>
#include "macos-titlebar-region.h"

@interface CaptionView : NSView
@end
@implementation CaptionView
- (BOOL)mouseDownCanMoveWindow { return YES; }
@end

// Match the native exclusion boundary: it blocks background dragging even
// though normal hit testing passes through to the renderer below it.
@interface ExclusionView : NSView
@end
@implementation ExclusionView
- (BOOL)mouseDownCanMoveWindow { return NO; }
- (NSView *)hitTest:(NSPoint)point { return nil; }
@end

int main(void) {
  @autoreleasepool {
    NSView *content = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 1000, 600)];
    NSView *parent = [[NSView alloc] initWithFrame:content.bounds];
    CaptionView *renderer = [[CaptionView alloc] initWithFrame:content.bounds];
    [content addSubview:parent];
    [parent addSubview:renderer];
    ExclusionView *tabs = [[ExclusionView alloc] initWithFrame:NSMakeRect(0, 555, 500, 45)];
    [parent addSubview:tabs];
    assert([content hitTest:NSMakePoint(100, 580)] == renderer);
    assert(!StudioCaptionContainsPoint(content, NSMakePoint(100, 580), 45));
    assert(StudioCaptionContainsPoint(content, NSMakePoint(800, 580), 45));
    assert(!StudioCaptionContainsPoint(content, NSMakePoint(800, 300), 45));
    assert(!StudioCaptionContainsPoint(content, NSMakePoint(1001, 580), 45));
    assert(!StudioCaptionContainsPoint(content, NSMakePoint(800, 555), 45));
    assert(StudioCaptionContainsPoint(content, NSMakePoint(800, 555.5), 45));
    ExclusionView *add = [[ExclusionView alloc] initWithFrame:NSMakeRect(500, 555, 42, 45)];
    [parent addSubview:add];
    assert(!StudioCaptionContainsPoint(content, NSMakePoint(520, 580), 45));
    tabs.hidden = YES;
    assert(StudioCaptionContainsPoint(content, NSMakePoint(100, 580), 45));
    tabs.hidden = NO;
    tabs.frame = content.bounds;
    assert(!StudioCaptionContainsPoint(content, NSMakePoint(800, 580), 45));
    [NSApplication sharedApplication];
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1000, 600)
        styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
          NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable |
          NSWindowStyleMaskFullSizeContentView
        backing:NSBackingStoreBuffered defer:NO];
    CaptionView *cover = [[CaptionView alloc] initWithFrame:window.contentView.bounds];
    [window.contentView addSubview:cover];
    for (NSInteger kind = NSWindowCloseButton; kind <= NSWindowZoomButton; kind++) {
      NSButton *button = [window standardWindowButton:kind];
      assert(button);
      NSPoint center = [button convertPoint:NSMakePoint(NSMidX(button.bounds),
                                                       NSMidY(button.bounds)) toView:nil];
      assert(!StudioCaptionContainsPoint(window.contentView, center, 45));
    }
    puts("Native caption exclusions passed: tabs, add, content, boundaries and document replacement");
  }
  return 0;
}
