#import <Cocoa/Cocoa.h>
#include <node_api.h>
#include "macos-titlebar-region.h"

@interface StudioTitlebarObserver : NSObject
@property(retain) NSWindow *window;
@property(retain) id monitor;
- (void)invalidate;
@end

@implementation StudioTitlebarObserver
- (void)invalidate {
  if (self.monitor) [NSEvent removeMonitor:self.monitor];
  self.monitor = nil;
  self.window = nil;
}
- (void)dealloc { [self invalidate]; [super dealloc]; }
- (NSEvent *)handleMouseDown:(NSEvent *)event {
  NSWindow *window = [[self.window retain] autorelease];
  if (!window || event.window != window || event.clickCount != 2 ||
      (event.modifierFlags & NSEventModifierFlagControl) ||
      (window.styleMask & NSWindowStyleMaskFullScreen) ||
      !StudioCaptionContainsPoint(window.contentView, event.locationInWindow, 45)) {
    return event;
  }
  NSString *action = [[NSUserDefaults standardUserDefaults]
      stringForKey:@"AppleActionOnDoubleClick"];
  if ([action isEqualToString:@"Minimize"]) {
    [window performMiniaturize:nil];
  } else if (!action.length || [action isEqualToString:@"Maximize"] ||
             [action isEqualToString:@"Fill"]) {
    [window performZoom:nil];
  } else {
    return event;
  }
  return nil;
}
@end

static void Finalize(napi_env env, void *data, void *hint) {
  StudioTitlebarObserver *observer = (StudioTitlebarObserver *)data;
  [observer invalidate];
  [observer release];
}

static napi_value Attach(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  bool buffer = false;
  if (argc) napi_is_buffer(env, args[0], &buffer);
  void *bytes = NULL;
  size_t length = 0;
  if (buffer) napi_get_buffer_info(env, args[0], &bytes, &length);
  if (length != sizeof(void *)) {
    napi_throw_type_error(env, NULL, "Expected a native window handle");
    return NULL;
  }
  NSView *content = *(NSView **)bytes;
  if (!content.window) {
    napi_throw_error(env, NULL, "Cannot attach to a closed window");
    return NULL;
  }
  StudioTitlebarObserver *observer = [[StudioTitlebarObserver alloc] init];
  observer.window = content.window;
  __block StudioTitlebarObserver *weakObserver = observer;
  observer.monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown
      handler:^NSEvent *(NSEvent *event) {
        StudioTitlebarObserver *current = weakObserver;
        return current ? [current handleMouseDown:event] : event;
      }];
  napi_value token;
  napi_create_external(env, observer, Finalize, NULL, &token);
  return token;
}

static napi_value Detach(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  void *data = NULL;
  if (!argc || napi_get_value_external(env, args[0], &data) != napi_ok) {
    napi_throw_type_error(env, NULL, "Expected a titlebar observer");
    return NULL;
  }
  [(StudioTitlebarObserver *)data invalidate];
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value attach, detach;
  napi_create_function(env, "attach", NAPI_AUTO_LENGTH, Attach, NULL, &attach);
  napi_create_function(env, "detach", NAPI_AUTO_LENGTH, Detach, NULL, &detach);
  napi_set_named_property(env, exports, "attach", attach);
  napi_set_named_property(env, exports, "detach", detach);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
