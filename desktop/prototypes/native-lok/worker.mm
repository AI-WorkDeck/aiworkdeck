// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Isolated research worker. It does not attach to an existing LibreOffice process.
#import <Foundation/Foundation.h>
#define LOK_USE_UNSTABLE_API
#define LOK_LOADLIB_GLOBAL
#include "vendor/LibreOfficeKit/LibreOfficeKitInit.h"
#include "vendor/LibreOfficeKit/LibreOfficeKitEnums.h"
#include <unistd.h>
#include <cstring>
#include <cerrno>
#include <mutex>
#include <vector>
#include <chrono>
#include <thread>
#include <dispatch/dispatch.h>
#include <atomic>
#include <sys/socket.h>
#include <netinet/in.h>

static int outputFd;
static std::mutex outputMutex;
static constexpr uint64_t maxFrame = 64 * 1024 * 1024;
// One short-lived loopback connection, solely for the isolated UNO capability probe.
static std::atomic<int> urpFd{-1};
static int urpListener = -1;
static void *urpBridge = nullptr;
struct DocumentIdentity { uint64_t epoch; int view; };
static uint64_t documentEpoch = 0, lastInputSeq = 0;
static std::atomic<uint64_t> refreshEpoch{0};
static DocumentIdentity *identity = nullptr;
static NSArray *reviewSnapshot;
static bool transfer(int fd, void *bytes, size_t size, bool writing) {
    auto *p = static_cast<unsigned char *>(bytes);
    while (size) {
        ssize_t n = writing ? write(fd, p, size) : read(fd, p, size);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return false;
        p += n; size -= n;
    }
    return true;
}
static void frame(NSDictionary *header, NSData *binary = nil) {
    NSData *json = [NSJSONSerialization dataWithJSONObject:header options:0 error:nil];
    uint32_t sizes[2] = {CFSwapInt32HostToLittle((uint32_t)json.length), CFSwapInt32HostToLittle((uint32_t)binary.length)};
    std::lock_guard<std::mutex> lock(outputMutex);
    transfer(outputFd, sizes, sizeof sizes, true);
    transfer(outputFd, const_cast<void *>(json.bytes), json.length, true);
    if (binary.length) transfer(outputFd, const_cast<void *>(binary.bytes), binary.length, true);
}
static void callback(int type, const char *payload, void *context) {
    @autoreleasepool {
        auto *owner = static_cast<DocumentIdentity *>(context);
        NSString *value = payload ? [NSString stringWithUTF8String:payload] : @"";
        if (owner && (type == LOK_CALLBACK_REDLINE_TABLE_SIZE_CHANGED || type == LOK_CALLBACK_REDLINE_TABLE_ENTRY_MODIFIED)) ++refreshEpoch;
        frame(@{@"type": @"callback", @"callbackType": @(type),
            @"payload": value, @"documentEpoch": @(owner ? owner->epoch : 0), @"viewId": @(owner ? owner->view : -1)});
    }
}
static NSArray *trackedChanges(LibreOfficeKitDocument *doc) {
    char *raw = doc->pClass->getCommandValues(doc, ".uno:AcceptTrackedChanges");
    if (!raw) return nil;
    NSData *data = [[NSString stringWithUTF8String:raw] dataUsingEncoding:NSUTF8StringEncoding];
    free(raw);
    id result = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    return [result isKindOfClass:NSDictionary.class] && [result[@"redlines"] isKindOfClass:NSArray.class] ? result[@"redlines"] : nil;
}
static NSDictionary *revisionWithId(NSArray *items, NSString *revisionId) {
    NSDictionary *found = nil;
    for (NSDictionary *item in items) if ([[item[@"index"] description] isEqual:revisionId]) {
        if (found) return nil;
        found = item;
    }
    return found;
}
static BOOL sameRevision(NSDictionary *a, NSDictionary *b) {
    if (!a || !b) return NO;
    for (NSString *key in @[@"index",@"type",@"author",@"dateTime",@"comment",@"description"]) {
        if (![a[key] isEqual:b[key]]) return NO;
    }
    return YES;
}
static NSArray *reviewItems(NSArray *items) {
    NSMutableArray *out = [NSMutableArray array];
    for (NSDictionary *item in items) {
        NSMutableArray *rects = [NSMutableArray array];
        for (NSString *rect in [item[@"textRange"] componentsSeparatedByString:@";"]) {
            NSArray *v = [rect componentsSeparatedByString:@","];
            if (v.count == 4) [rects addObject:@{@"x": @([v[0] doubleValue]), @"y": @([v[1] doubleValue]), @"width": @([v[2] doubleValue]), @"height": @([v[3] doubleValue])}];
        }
        [out addObject:@{@"revisionId": [item[@"index"] description], @"author": item[@"author"] ?: @"", @"type": item[@"type"] ?: @"",
            @"dateTime": item[@"dateTime"] ?: @"", @"description": item[@"description"] ?: @"", @"rects": rects,
            @"text": NSNull.null, @"textAvailable": @NO}];
    }
    return out;
}
static NSString *selectedText(LibreOfficeKitDocument *doc) {
    char *mime=nullptr; char *text=doc->pClass->getTextSelection(doc,"text/plain;charset=utf-8",&mime);
    NSString *result=text ? [NSString stringWithUTF8String:text] : @"";
    free(text); free(mime); return result;
}
static void postCommand(LibreOfficeKitDocument *doc, NSString *command, NSDictionary *args) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:args options:0 error:nil];
    NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    doc->pClass->postUnoCommand(doc, command.UTF8String, json.UTF8String, true);
}
static NSString *errorOf(LibreOfficeKit *kit) {
    char *s = kit->pClass->getError(kit);
    NSString *result = s ? [NSString stringWithUTF8String:s] : @"";
    if (s) kit->pClass->freeError(s);
    return result;
}
static NSString *safeUrl(NSString *path, NSString *root) {
    NSString *resolved = path.stringByStandardizingPath.stringByResolvingSymlinksInPath;
    if (![resolved hasPrefix:[root stringByAppendingString:@"/"]]) return nil;
    return [NSURL fileURLWithPath:resolved].absoluteString;
}

int main(int argc, char **argv) {
    @autoreleasepool {
        if (argc != 4) { fprintf(stderr, "usage: worker LO-Frameworks isolated-profile-url artifact-root\n"); return 2; }
        outputFd = dup(STDOUT_FILENO);
        dup2(STDERR_FILENO, STDOUT_FILENO); // Native diagnostics must not corrupt framed stdout.
        NSString *root = [NSString stringWithUTF8String:argv[3]].stringByStandardizingPath.stringByResolvingSymlinksInPath;
        auto started = std::chrono::steady_clock::now();
        frame(@{@"type": @"phase", @"phase": @"before-lok-init"});
        LibreOfficeKit *kit = lok_init_2(argv[1], argv[2]);
        if (!kit) { frame(@{@"type": @"fatal", @"error": @"lok_init_2 returned null"}); return 3; }
        if (!LIBREOFFICEKIT_HAS(kit, runLoop) || !kit->pClass->runLoop) {
            frame(@{@"type": @"fatal", @"error": @"runtime lacks required runLoop API"}); return 3;
        }
        frame(@{@"type": @"phase", @"phase": @"after-lok-init"});
        kit->pClass->registerCallback(kit, callback, nullptr);
        char *version = kit->pClass->getVersionInfo(kit);
        NSDictionary *ready = @{@"type": @"engine-ready", @"version": version ? [NSString stringWithUTF8String:version] : @"",
            @"initMs": @(std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now()-started).count()),
            @"startURPAvailable": @(LIBREOFFICEKIT_HAS(kit, startURP) && kit->pClass->startURP != nullptr)};
        free(version);
        static LibreOfficeKitDocument *doc = nullptr; // Accessed only by the main dispatch queue.
        dispatch_async(dispatch_get_main_queue(), ^{ frame(ready); });
        std::thread([&] {
        while (true) {
            @autoreleasepool {
                uint32_t sizes[2];
                if (!transfer(STDIN_FILENO, sizes, sizeof sizes, false)) break;
                uint32_t h = CFSwapInt32LittleToHost(sizes[0]), b = CFSwapInt32LittleToHost(sizes[1]);
                if (!h || (uint64_t)h + b > maxFrame) { frame(@{@"type": @"fatal", @"error": @"invalid frame size"}); break; }
                NSMutableData *header = [NSMutableData dataWithLength:h];
                NSMutableData *binary = [NSMutableData dataWithLength:b];
                if (!transfer(STDIN_FILENO, header.mutableBytes, h, false) || (b && !transfer(STDIN_FILENO, binary.mutableBytes, b, false))) break;
                id parsed = [NSJSONSerialization JSONObjectWithData:header options:0 error:nil];
                if (![parsed isKindOfClass:NSDictionary.class]) { frame(@{@"type": @"fatal", @"error": @"invalid JSON object"}); break; }
                NSDictionary *q = parsed;
                // Aqua requires both its event loop and every document operation on the main thread.
                dispatch_sync(dispatch_get_main_queue(), ^{
                NSString *action = q[@"action"];
                NSMutableDictionary *r = [@{@"type": @"result", @"reqId": q[@"reqId"] ?: @0, @"success": @YES} mutableCopy];
                NSData *replyBytes = nil;
                auto t = std::chrono::steady_clock::now();
                if ([action isEqual:@"open"]) {
                    NSString *url = safeUrl(q[@"path"], root);
                    if (!url || doc) { r[@"success"]=@NO; r[@"error"]=@"invalid local path or document already open"; }
                    else {
                        doc = kit->pClass->documentLoadWithOptions(kit, url.UTF8String, "Language=zh-CN");
                        if (doc && (!LIBREOFFICEKIT_DOCUMENT_HAS(doc, postWindowExtTextInputEvent) || !doc->pClass->postWindowExtTextInputEvent)) {
                            doc->pClass->destroy(doc); doc=nullptr;
                            r[@"success"]=@NO; r[@"error"]=@"runtime lacks required document API";
                        }
                        if (doc) {
                            ++documentEpoch; ++refreshEpoch; lastInputSeq=0; reviewSnapshot=nil;
                            // Retain each small callback context until process exit: an old queued callback must never acquire the new document's identity.
                            identity = new DocumentIdentity{documentEpoch,doc->pClass->getView(doc)};
                            doc->pClass->registerCallback(doc, callback, identity);
                            doc->pClass->initializeForRendering(doc, "{\".uno:Author\":{\"type\":\"string\",\"value\":\"Native Prototype\"}}");
                            long w=0, height=0; doc->pClass->getDocumentSize(doc,&w,&height);
                            r[@"widthTwips"]=@(w); r[@"heightTwips"]=@(height);
                            r[@"kind"]=@(doc->pClass->getDocumentType(doc));
                        } else if (!r[@"error"]) { r[@"success"]=@NO; r[@"error"]=errorOf(kit); }
                    }
                } else if ([action isEqual:@"shutdown"]) {
                    if (urpListener>=0) { close(urpListener); urpListener=-1; }
                    int connection=urpFd.exchange(-1);
                    if (connection>=0) { shutdown(connection,SHUT_RDWR); close(connection); }
                    if (doc) { doc->pClass->destroy(doc); doc=nullptr; }
                    frame(r);
                    // The owned document has been saved/closed explicitly. URP
                    // release threads can still be draining; exit() runs global
                    // Writer destructors concurrently with them (observed crash).
                    // This isolated worker owns no external document or profile.
                    _exit(0);
                }
                else if (!doc) { r[@"success"]=@NO; r[@"error"]=@"DOCUMENT_NOT_READY"; }
                else if (([action hasPrefix:@"review_"] || [action hasPrefix:@"input_"] || [action isEqual:@"set_viewport"] || [action isEqual:@"close"] || q[@"documentEpoch"])
                    && (!q[@"documentEpoch"] || [q[@"documentEpoch"] unsignedLongLongValue] != documentEpoch)) {
                    r[@"success"]=@NO; r[@"error"]=@"STALE_DOCUMENT";
                }
                else if ([action isEqual:@"close"]) {
                    doc->pClass->destroy(doc); doc=nullptr; identity=nullptr; ++documentEpoch; ++refreshEpoch;
                    lastInputSeq=0; reviewSnapshot=nil;
                }
                else if ([action isEqual:@"review_snapshot"]) {
                    NSArray *items=trackedChanges(doc);
                    if (!items) { r[@"success"]=@NO; r[@"error"]=@"REVIEW_UNAVAILABLE"; }
                    else {
                        reviewSnapshot=items; r[@"refreshEpoch"]=@(++refreshEpoch); r[@"items"]=reviewItems(items);
                        long w=0,h=0; doc->pClass->getDocumentSize(doc,&w,&h); r[@"widthTwips"]=@(w); r[@"heightTwips"]=@(h);
                    }
                }
                else if ([action isEqual:@"review_goto"] || [action isEqual:@"review_resolve"]) {
                    NSString *revisionId=[q[@"revisionId"] description];
                    NSArray *current=trackedChanges(doc);
                    NSDictionary *expected=revisionWithId(reviewSnapshot,revisionId), *actual=revisionWithId(current,revisionId);
                    if (!q[@"refreshEpoch"] || [q[@"refreshEpoch"] unsignedLongLongValue]!=refreshEpoch || !expected || !actual || ![expected isEqual:actual]) {
                        r[@"success"]=@NO; r[@"error"]=@"STALE_REVIEW";
                    } else if ([action isEqual:@"review_goto"]) {
                        postCommand(doc,@".uno:NextTrackedChange",@{@"NextTrackedChange":@{@"type":@"uint32",@"value":@([revisionId longLongValue])}});
                        r[@"text"]=selectedText(doc); r[@"revisionId"]=revisionId; r[@"acceptedForDispatch"]=@YES;
                        // Copying a selected deletion returns empty text. The host verifies the
                        // actual view-cursor range through the URL-bound UNO helper instead.
                    } else if (![q[@"decision"] isEqual:@"accept"] && ![q[@"decision"] isEqual:@"reject"]) {
                        r[@"success"]=@NO; r[@"error"]=@"INVALID_REVIEW_DECISION";
                    } else {
                        postCommand(doc,@".uno:NextTrackedChange",@{@"NextTrackedChange":@{@"type":@"uint32",@"value":@([revisionId longLongValue])}});
                        NSString *name=[q[@"decision"] isEqual:@"accept"] ? @"AcceptTrackedChange" : @"RejectTrackedChange";
                        postCommand(doc,[@".uno:" stringByAppendingString:name],@{name:@{@"type":@"uint32",@"value":@([revisionId longLongValue])}});
                        NSArray *after=trackedChanges(doc);
                        NSDictionary *remaining=revisionWithId(after,revisionId);
                        BOOL verified=after && (!remaining || !sameRevision(actual,remaining));
                        // A correct single-target dispatch must not silently resolve an unrelated entry.
                        // Connected multi-entry families need the full product grouping contract; fail closed here.
                        for (NSDictionary *other in current) {
                            if ([[other[@"index"] description] isEqual:revisionId]) continue;
                            if (!sameRevision(other,revisionWithId(after,[other[@"index"] description]))) verified=NO;
                        }
                        r[@"success"]=@(verified); r[@"applied"]=@(verified); r[@"outcomeUnknown"]=@(!verified);
                        r[@"revisionId"]=revisionId; r[@"remainingCount"]=@(after.count); ++refreshEpoch; reviewSnapshot=nil;
                        if (!verified) r[@"error"]=@"REVIEW_OUTCOME_NOT_VERIFIED";
                    }
                }
                else if ([action isEqual:@"review_view"]) {
                    // The host implements all/final through typed UNO; the patched margin mode is unavailable.
                    r[@"success"]=@NO; r[@"error"]=@"TYPED_UNO_VIEW_REQUIRED";
                }
                else if ([action isEqual:@"set_viewport"]) {
                    int w=[q[@"width"] ?: q[@"cssWidth"] intValue], h=[q[@"height"] ?: q[@"cssHeight"] intValue];
                    int tw=[q[@"widthTwips"] intValue], th=[q[@"heightTwips"] intValue];
                    if (w<=0 || h<=0 || tw<=0 || th<=0) { r[@"success"]=@NO; r[@"error"]=@"INVALID_VIEWPORT"; }
                    else { doc->pClass->setClientZoom(doc,w,h,tw,th); doc->pClass->setClientVisibleArea(doc,[q[@"xTwips"] intValue],[q[@"yTwips"] intValue],tw,th); r[@"applied"]=@YES; }
                }
                else if ([action hasPrefix:@"input_"]) {
                    uint64_t seq=[q[@"inputSeq"] unsignedLongLongValue];
                    BOOL barrier=[action isEqual:@"input_barrier"];
                    if (!q[@"inputSeq"] || seq != lastInputSeq+(barrier ? 0 : 1)) { r[@"success"]=@NO; r[@"error"]=@"INPUT_SEQUENCE_MISMATCH"; }
                    else {
                        if ([action isEqual:@"input_text"] && [q[@"text"] isKindOfClass:NSString.class]) {
                            if ([q[@"text"] rangeOfString:[NSString stringWithFormat:@"%C",(unichar)0]].location != NSNotFound) {
                                r[@"success"]=@NO; r[@"error"]=@"INVALID_INPUT_NUL";
                            } else {
                            doc->pClass->postWindowExtTextInputEvent(doc,0,LOK_EXT_TEXTINPUT,[q[@"text"] UTF8String]);
                            doc->pClass->postWindowExtTextInputEvent(doc,0,LOK_EXT_TEXTINPUT_END,"");
                            }
                        } else if ([action isEqual:@"input_key"] && [q[@"eventType"] intValue]>=0 && [q[@"eventType"] intValue]<=1) {
                            int key=[q[@"keyCode"] intValue], base=key & 0xFFF;
                            BOOL nativeFileShortcut=(key & (0x2000|0x8000)) && (base==526 || base==527 || base==528 || base==530 || base==534);
                            if (nativeFileShortcut) { r[@"success"]=@NO; r[@"error"]=@"HOST_FILE_OPERATION_REQUIRED"; }
                            else doc->pClass->postKeyEvent(doc,[q[@"eventType"] intValue],[q[@"charCode"] intValue],key);
                        } else if ([action isEqual:@"input_mouse"] && [q[@"eventType"] intValue]>=0 && [q[@"eventType"] intValue]<=2) {
                            doc->pClass->postMouseEvent(doc,[q[@"eventType"] intValue],[q[@"xTwips"] intValue],[q[@"yTwips"] intValue],[q[@"clickCount"] intValue],[q[@"buttons"] intValue],[q[@"modifier"] intValue]);
                        } else if (!barrier) { r[@"success"]=@NO; r[@"error"]=@"INVALID_INPUT"; }
                        if ([r[@"success"] boolValue]) { lastInputSeq=seq; r[@"applied"]=@YES; if (!barrier) ++refreshEpoch; }
                    }
                    r[@"lastInputSeq"]=@(lastInputSeq);
                }
                else if ([action isEqual:@"start_urp"]) {
                    if (urpListener >= 0 || urpBridge || !LIBREOFFICEKIT_HAS(kit, startURP) || !kit->pClass->startURP) {
                        r[@"success"]=@NO; r[@"error"]=@"URP_UNAVAILABLE_OR_ALREADY_STARTED";
                    } else {
                        int listener=socket(AF_INET,SOCK_STREAM,0);
                        sockaddr_in address{}; address.sin_family=AF_INET; address.sin_addr.s_addr=htonl(INADDR_LOOPBACK);
                        socklen_t size=sizeof address;
                        if (listener<0 || bind(listener,reinterpret_cast<sockaddr *>(&address),size) || listen(listener,1)
                            || getsockname(listener,reinterpret_cast<sockaddr *>(&address),&size)) {
                            if (listener>=0) close(listener);
                            r[@"success"]=@NO; r[@"error"]=@"URP_LISTEN_FAILED";
                        } else {
                            urpListener=listener; r[@"port"]=@(ntohs(address.sin_port));
                            std::thread([kit,listener] {
                                int connection=accept(listener,nullptr,nullptr);
                                if (connection<0) return;
                                int yes=1; setsockopt(connection,SOL_SOCKET,SO_NOSIGPIPE,&yes,sizeof yes);
                                urpFd=connection;
                                dispatch_async(dispatch_get_main_queue(), ^{
                                    close(urpListener); urpListener=-1;
                                    urpBridge=kit->pClass->startURP(kit,&urpFd,&urpFd,
                                        [](void *context,const signed char *bytes,int length) {
                                            int fd=static_cast<std::atomic<int> *>(context)->load();
                                            return transfer(fd,const_cast<signed char *>(bytes),length,true) ? length : 0;
                                        },
                                        [](void *context,signed char *bytes,int length) {
                                            int fd=static_cast<std::atomic<int> *>(context)->load();
                                            return transfer(fd,bytes,length,false) ? length : 0;
                                        });
                                    frame(@{@"type":@"phase",@"phase":@"urp-connected",@"success":@(urpBridge!=nullptr)});
                                });
                            }).detach();
                        }
                    }
                }
                else if ([action isEqual:@"paint"]) {
                    int w=[q[@"width"] intValue], height=[q[@"height"] intValue];
                    if (w<=0 || height<=0 || w>2048 || height>2048) { r[@"success"]=@NO; r[@"error"]=@"invalid pixel extent"; }
                    else {
                        NSMutableData *pixels = [NSMutableData dataWithLength:(NSUInteger)w*height*4];
                        memset(pixels.mutableBytes, 0xA5, pixels.length);
                        doc->pClass->paintTile(doc, static_cast<unsigned char *>(pixels.mutableBytes),w,height,
                            [q[@"xTwips"] intValue],[q[@"yTwips"] intValue],[q[@"widthTwips"] intValue],[q[@"heightTwips"] intValue]);
                        size_t changed=0; const auto *p=static_cast<const unsigned char *>(pixels.bytes);
                        for (NSUInteger i=0;i<pixels.length;i++) if (p[i]!=0xA5) changed++;
                        r[@"changedBytes"]=@(changed); r[@"tileMode"]=@(doc->pClass->getTileMode(doc));
                        r[@"engineError"]=errorOf(kit); r[@"pixelsChanged"]=@(changed>0); replyBytes=pixels;
                    }
                } else if ([action isEqual:@"values"]) {
                    char *v=doc->pClass->getCommandValues(doc,[q[@"command"] UTF8String]);
                    r[@"success"]=@(v!=nullptr);
                    r[@"value"]=v ? [NSString stringWithUTF8String:v] : @""; free(v); r[@"engineError"]=errorOf(kit);
                } else if ([action isEqual:@"command"]) {
                    doc->pClass->postUnoCommand(doc,[q[@"command"] UTF8String],[q[@"arguments"] UTF8String],true);
                    r[@"acceptedForDispatch"]=@YES; // Completion and actual changes require separate verification.
                } else if ([action isEqual:@"key"]) {
                    doc->pClass->postKeyEvent(doc,[q[@"eventType"] intValue],[q[@"charCode"] intValue],[q[@"keyCode"] intValue]);
                } else if ([action isEqual:@"paste"]) {
                    r[@"success"]=@(doc->pClass->paste(doc,"text/plain;charset=utf-8",static_cast<const char *>(binary.bytes),binary.length));
                } else if ([action isEqual:@"selected_text"] || [action isEqual:@"selection_text"]) {
                    r[@"text"]=selectedText(doc);
                } else if ([action isEqual:@"save"]) {
                    NSString *url=safeUrl(q[@"path"],root);
                    r[@"success"]=@(url && doc->pClass->saveAs(doc,url.UTF8String,"docx",nullptr));
                    r[@"engineError"]=errorOf(kit);
                } else { r[@"success"]=@NO; r[@"error"]=@"UNSUPPORTED_PROTOTYPE_ACTION"; }
                r[@"elapsedMs"]=@(std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-t).count());
                r[@"documentEpoch"]=@(documentEpoch); r[@"viewId"]=@(identity ? identity->view : -1);
                frame(r,replyBytes);
                });
            }
        }
        dispatch_async(dispatch_get_main_queue(), ^{ if (doc) doc->pClass->destroy(doc); exit(1); });
        }).detach();
        kit->pClass->runLoop(kit, [](void *, int) { return 0; }, [](void *) {}, kit);
    }
    return 0;
}
