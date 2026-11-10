import contextlib
import json
import sys
from pathlib import Path
from .records import RecordStore
from .ocr import OcrEngine


def main():
    config = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
    store = RecordStore(config['dataRoot'])
    engine = OcrEngine(config)
    protocol = sys.stdout

    def send(value):
        protocol.write(json.dumps(value, ensure_ascii=False) + '\n')
        protocol.flush()

    for line in sys.stdin:
        request_id = None
        try:
            request = json.loads(line)
            request_id = request['request_id']
            if request.get('version') != 1:
                raise ValueError('不支持的协议版本')
            method = request['method']
            params = request.get('params', {})
            with contextlib.redirect_stdout(sys.stderr):
                if method == 'ping':
                    result = dict(python=sys.version.split()[0], device=config.get('device', 'gpu:0'), ready=engine.pipeline is not None)
                elif method == 'initialize':
                    engine.close()
                    engine.config['device'] = params.get('device', config.get('device', 'gpu:0'))
                    send(dict(request_id=request_id, event='progress', stage='initializing'))
                    engine.initialize()
                    result = dict(ready=True, device=engine.config['device'])
                elif method == 'recognize':
                    record = store.get_record(params['recordId'])
                    requested_device = params.get('device')
                    if requested_device and requested_device != engine.config.get('device'):
                        engine.close()
                        engine.config['device'] = requested_device
                    send(dict(request_id=request_id, event='progress', stage='ocr'))
                    result = engine.recognize(Path(record['capture']['croppedPath']))
                    store.save_ocr(params['recordId'], result, raw=engine.last_raw)
                elif method == 'create_capture':
                    result = store.create_capture(params['originalPath'], params['croppedPath'], params.get('roi'))
                elif method == 'save_ocr':
                    result = store.save_ocr(params['recordId'], params['document'])
                elif method == 'set_status':
                    result = store.set_status(params['recordId'], params['status'], params.get('error'))
                elif method == 'add_attempt':
                    result = store.add_attempt(params['recordId'], params['payload'], params.get('document'))
                elif method == 'finish_attempt':
                    result = store.finish_attempt(params['recordId'], params['attemptId'], params['result'], params.get('metadata', {}))
                elif method == 'update_attempt':
                    result = store.update_attempt(params['recordId'], params['attemptId'], params['payload'], params.get('document'))
                elif method == 'list_records':
                    result = store.list_records(params.get('status'), params.get('limit', 200), params.get('offset', 0))
                elif method == 'get_record':
                    result = store.get_record(params['recordId'])
                elif method == 'delete_record':
                    result = store.delete_record(params['recordId'])
                elif method == 'shutdown':
                    engine.close()
                    store.close()
                    send(dict(request_id=request_id, result=True))
                    return
                else:
                    raise ValueError('不支持的操作')
            send(dict(request_id=request_id, result=result))
        except Exception as exc:
            # Never log full request, report contents, or HTTP credentials.
            messages = {'ValueError': str(exc), 'FileNotFoundError': '所需文件不存在，请检查运行环境和模型路径', 'PermissionError': '文件访问被拒绝，请检查数据目录权限'}
            send(dict(request_id=request_id, error=dict(code=type(exc).__name__, message=messages.get(type(exc).__name__, f'本地处理失败（{type(exc).__name__}），请检查模型环境或重试'))))
    engine.close()
    store.close()


if __name__ == '__main__':
    main()
