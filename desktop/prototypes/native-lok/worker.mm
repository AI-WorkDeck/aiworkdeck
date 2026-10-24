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
static bool transfer(int fd, void *bytes, size_t size, bool writing) {
    auto *p = static_cast<unsigned char *>(bytes);
    while (size) {
        ssize_t n = writing ? write(fd, p, size) : read(fd, p, size);
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
static void callback(int type, const char *payload, void *) {
    @autoreleasepool {
        frame(@{@"type": @"callback", @"callbackType": @(type),
            @"payload": payload ? [NSString stringWithUTF8String:payload] : @""});
    }
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
                        if (doc && !LIBREOFFICEKIT_DOCUMENT_HAS(doc, getCommandValues)) {
                            doc->pClass->destroy(doc); doc=nullptr;
                            r[@"success"]=@NO; r[@"error"]=@"runtime lacks required document API";
                        }
                        if (doc) {
                            doc->pClass->registerCallback(doc, callback, nullptr);
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
                    exit(0); // Isolated unipoll process: no external document or shared profile exists.
                }
                else if (!doc) { r[@"success"]=@NO; r[@"error"]=@"DOCUMENT_NOT_READY"; }
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
                } else if ([action isEqual:@"selected_text"]) {
                    char *mime=nullptr; char *v=doc->pClass->getTextSelection(doc,"text/plain;charset=utf-8",&mime);
                    r[@"text"]=v ? [NSString stringWithUTF8String:v] : @""; free(v); free(mime);
                } else if ([action isEqual:@"save"]) {
                    NSString *url=safeUrl(q[@"path"],root);
                    r[@"success"]=@(url && doc->pClass->saveAs(doc,url.UTF8String,"docx",nullptr));
                    r[@"engineError"]=errorOf(kit);
                } else { r[@"success"]=@NO; r[@"error"]=@"UNSUPPORTED_PROTOTYPE_ACTION"; }
                r[@"elapsedMs"]=@(std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-t).count());
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
