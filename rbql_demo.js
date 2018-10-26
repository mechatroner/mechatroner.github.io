var rbql_utils = null;
var rbql = null;
var rbql_worker = null;


var template_js_text = null;


var table_loaded = false;

var current_delim = null;
var current_policy = null;
var current_input_lines = null;
var current_output_lines = null;


function WebEmulationError(message) {
   this.message = message;
   this.name = 'WebEmulationError';
}


function AssertionError(message) {
   this.message = message;
   this.name = 'AssertionError';
}


var __dirname = 'fake_rbql_home_dir';

var last_web_writer = null;
var last_web_reader = null;


function assert(condition, message) {
    if (!condition) {
        throw new AssertionError(message);
    }
}


function fake_module_os() {
    this.homedir = function() {
        return 'fake_web_home_dir';
    }
}


function fake_module_path() {
    this.join = function(a, b) {
        return `${a}/${b}`;
    }
}


function WebWriter() {
    this.write = function(line) {
        if (line == '\n') {
            return;
        }
        current_output_lines.push(line);
    }
}


function WebReader() {
    this.line_callback = null;
    this.close_callback = null;
    this.closed = false;
    this.on = function(method, callback_func) {
        assert(method == 'line' || method == 'close');
        if (method == 'line') {
            this.line_callback = callback_func;
        }
        if (method == 'close') {
            this.close_callback = callback_func;
        }
    }
    this.close = function() {
        this.closed = true;
        this.close_callback();
    }
    this.feed_line = function(line) {
        this.line_callback(line);
    }
}


function fake_module_fs() {
    this.readFileSync = function(path, encoding) {
        throw new WebEmulationError('JOIN is not available in web mode');
    }
    this.existsSync = function(path) {
        throw new WebEmulationError('JOIN is not available in web mode');
    }
    this.writeFileSync = function(path, data) {
        throw new WebEmulationError('JOIN is not available in web mode');
    }
    this.createReadStream = function(dummy_arg1, dummy_arg2) {
        return null;
    }
    this.createWriteStream = function(dummy_arg1, dummy_arg2) {
        return last_web_writer;
    }
}

function fake_module_readline() {
    this.createInterface = function(dummy_arg) {
        return last_web_reader;
    }
}


function require(module_name_to_fake) {
    // this is a fake require function
    if (module_name_to_fake == 'os') {
        return new fake_module_os(); 
    } else if (module_name_to_fake == 'path') {
        return new fake_module_path();
    } else if (module_name_to_fake == 'fs') {
        return new fake_module_fs();
    } else if (module_name_to_fake == 'readline') {
        return new fake_module_readline();
    } else if (module_name_to_fake == `${__dirname}/rbql_utils.js`) {
        return rbql_utils;
    } else {
        throw new WebEmulationError(`Unknown module: "${module_name_to_fake}"`);
    }
}


function extract_next_field(src, dlm, preserve_quotes, cidx, result) {
    var warning = false;
    if (src.charAt(cidx) === '"') {
        var uidx = src.indexOf('"', cidx + 1);
        while (uidx != -1 && uidx + 1 < src.length && src.charAt(uidx + 1) == '"') {
            uidx = src.indexOf('"', uidx + 2);
        }
        if (uidx != -1 && (uidx + 1 == src.length || src.charAt(uidx + 1) == dlm)) {
            if (preserve_quotes) {
                result.push(src.substring(cidx, uidx + 1));
            } else {
                result.push(src.substring(cidx + 1, uidx).replace(/""/g, '"'));
            }
            return [uidx + 2, false];
        }
        warning = true;
    }
    var uidx = src.indexOf(dlm, cidx);
    if (uidx == -1)
        uidx = src.length;
    var field = src.substring(cidx, uidx);
    warning = warning || field.indexOf('"') != -1;
    result.push(field);
    return [uidx + 1, warning];
}


function split_quoted_str(src, dlm, preserve_quotes=false) {
    if (src.indexOf('"') == -1) // Optimization for most common case
        return [src.split(dlm), false];
    var result = [];
    var cidx = 0;
    var warning = false;
    while (cidx < src.length) {
        var extraction_report = extract_next_field(src, dlm, preserve_quotes, cidx, result);
        cidx = extraction_report[0];
        warning = warning || extraction_report[1];
    }
    if (src.charAt(src.length - 1) == dlm)
        result.push('');
    return [result, warning];
}


function smart_split(src, dlm, policy, preserve_quotes) {
    if (policy === 'simple')
        return [src.split(dlm), false];
    if (policy === 'monocolumn')
        return [[src], false];
    return split_quoted_str(src, dlm, preserve_quotes);
}


function get_field_by_line_position(fields, query_pos) {
    if (!fields.length)
        return null;
    var col_num = 0;
    var cpos = fields[col_num].length + 1;
    while (query_pos > cpos && col_num + 1 < fields.length) {
        col_num += 1;
        cpos = cpos + fields[col_num].length + 1;
    }
    return col_num;
}


function remove_children(root_node) {
    while (root_node.firstChild) {
        root_node.removeChild(root_node.firstChild);
    }
}

function append_cell(row, cell_style, cell_text) {
    let cell = document.createElement('td');
    cell.style.border = cell_style;
    cell.textContent = cell_text;
    row.appendChild(cell);
}

function make_preview_table(table, records, make_header) {
    remove_children(table);
    if (records.length == 0)
        return;
    if (make_header) {
        let row = document.createElement('tr');
        table.appendChild(row);
        append_cell(row, '1px solid red', 'NR');
        for (let i = 0; i < records[0].length; i++) {
            append_cell(row, '1px solid red', `a${i + 1}`);
        }
    }
    for (var nr = 0; nr < records.length; nr++) {
        let row = document.createElement('tr');
        table.appendChild(row);
        if (make_header) {
            append_cell(row, '1px solid red', nr + 1);
        }
        for (var nf = 0; nf < records[nr].length; nf++) {
            append_cell(row, '1px solid #4A5646', records[nr][nf]);
        }
    }
}


function strip_cr(line) {
    if (line.charAt(line.length - 1) === '\r') {
        return line.substring(0, line.length - 1);
    }
    return line;
}


function do_load_table(file_text, delim, policy) {
    current_delim = delim;
    current_policy = policy;
    table_loaded = false;
    var lines = file_text.split('\n');
    var records = [];
    current_input_lines = [];
    var warning_line = null;
    for (var r = 0; r < lines.length; ++r) {
        let line = lines[r];
        line = strip_cr(line);
        if (r + 1 == lines.length && line.length == 0)
            break;
        current_input_lines.push(line);
        var report = smart_split(line, delim, policy);
        var fields = report[0];
        var warning = report[1];
        if (warning && warning_line == null) {
            warning_line = r + 1;
        }
        records.push(fields);
    }
    if (warning_line != null) {
        show_warnings('Input file has quoting issues', ['Double quotes usage is not consistent at some lines. E.g. at line ' + warning_line]);
    }
    var table = document.getElementById('preview_table');
    if (records.length > 1000) {
        document.getElementById('input_cut_warning').style.display = 'block';
        records = records.slice(0, 1000);
    } else {
        document.getElementById('input_cut_warning').style.display = 'none';
    }
    make_preview_table(table, records, true);
    table_loaded = true;
}


function load_default_table(callback_func) {
    var local_url = 'movies.tsv';
    var xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function () {
        if (xhr.readyState == XMLHttpRequest.DONE) {
            do_load_table(xhr.responseText, '\t', 'simple');
            callback_func();
        }
    }
    xhr.open('GET', local_url, true);
    xhr.send(null);
}


function load_worker_template(callback_func) {
    var local_url = 'template.js.raw';
    var xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function () {
        if (xhr.readyState == XMLHttpRequest.DONE) {
            template_js_text = xhr.responseText;
            callback_func();
        }
    }
    xhr.open('GET', local_url, true);
    xhr.send(null);
}


function load_module_from_string(module_name, node_module_string) {
    var module = {'exports': {}};
    eval('(function(){' + node_module_string + '})()');
    console.log('sussess eval');
    eval(`${module_name} = module.exports;`);
}


function load_module(module_name, url, callback_func) {
    var request = new XMLHttpRequest();
    request.onreadystatechange = function () {
        if (request.readyState !== 4)
            return;
        if (request.status !== 200)
            return;
        load_module_from_string(module_name, request.responseText);
        callback_func();
    };
    request.open('GET', url);
    request.send();
}


function handle_rbql_worker_success(warnings) {
    console.log('warnings: ' + JSON.stringify(warnings));
    if (warnings) {
        let hr_warnings = rbql.make_warnings_human_readable(warnings);
        show_warnings('RBQL Query has finished with Warnings', hr_warnings);
    }
    var table = document.getElementById('output_table');
    var records = [];
    for (var i = 0; i < current_output_lines.length; i++) {
        records.push(smart_split(current_output_lines[i], current_delim, current_policy)[0]);
    }
    if (records.length > 1000) {
        document.getElementById('output_cut_warning').style.display = 'block';
        records = records.slice(0, 1000);
    } else {
        document.getElementById('output_cut_warning').style.display = 'none';
    }
    make_preview_table(table, records, false);
    document.getElementById('output_group').style.display = 'block';
}


function handle_rbql_worker_error(error_msg) {
    show_error('RBQL Backend', error_msg);
}


function get_error_message(error) {
    if (error && error.message)
        return error.message;
    return String(error);
}


function start_rbql() {
    document.getElementById('output_group').style.display = 'none';
    var rbql_text = document.getElementById('rbql_input').value;
    if (!rbql_text)
        return;
    current_output_lines = [];
    last_web_writer = new WebWriter();
    last_web_reader = new WebReader();
    let worker_text = null;
    try {
        worker_text = rbql.parse_to_js_almost_web('fake_src_path', 'fake_dst_path', [rbql_text], template_js_text, current_delim, current_policy, current_delim, current_policy, 'binary');
    } catch (e) {
        show_error('RBQL parsing', get_error_message(e));
        return;
    }
    load_module_from_string('rbql_worker', worker_text);
    rbql_worker.run_on_node(handle_rbql_worker_success, handle_rbql_worker_error);
    for (let i = 0; i < current_input_lines.length; i++) {
        let line = current_input_lines[i];
        if (last_web_reader.closed) {
            console.log(`last web reader was closed at line ${i}`);
            break;
        }
        last_web_reader.feed_line(line);
    }
    last_web_reader.close();
}


function show_warnings(warning_header, warnings) {
    document.getElementById('error_header').textContent = 'WARNING';
    document.getElementById('rbql_error_message_header').style.backgroundColor = '#EFDB00'; 
    document.getElementById('error_message_header').textContent = warning_header;
    document.getElementById('error_message_details').textContent = '';
    for (let i = 0; i < warnings.length; i++) {
        if (i) {
            document.getElementById('error_message_details').textContent += '\r\n';
        }
        document.getElementById('error_message_details').textContent += warnings[i];
    }
    document.getElementById('rbql_error_message').style.display = 'block';
}


function show_error(error_type, error_details) {
    error_details = error_details.replace('\r?\n', '\r\n');
    document.getElementById('error_header').textContent = 'Error while executing RBQL query!';
    document.getElementById('rbql_error_message_header').style.backgroundColor = '#FF4444';
    document.getElementById('error_message_header').textContent = 'Error type: "' + error_type + '"';
    document.getElementById('error_message_details').textContent = error_details;
    document.getElementById('rbql_error_message').style.display = 'block';
}


function hide_error_msg() {
    document.getElementById('rbql_error_message').style.display = 'none';
}


function save_result_table() {
    let output_lines = [];
    var file_content = current_output_lines.join('\r\n')
    var blob = new Blob([file_content], {type: "text/plain;charset=utf-8"});
    saveAs(blob, "rbql_output.txt");
}


function open_custom_table_dialog() {
    document.getElementById('table_load_dialog').style.display = 'block';
}


function close_custom_table_dialog() {
    document.getElementById('table_load_dialog').style.display = 'none';
}


function process_submit() {
    var inputElem = document.getElementById("doLoadTable");
    var selected_file = inputElem.files[0];
    let drop_down_list = document.getElementById("separator_ddl");
    let dialect_name = drop_down_list.options[drop_down_list.selectedIndex].value;
    let dialect_map = {'csv': [',', 'quoted'], 'tsv': ['\t', 'simple'], 'csv (semicolon)': [';', 'quoted'], 'csv (pipe)': ['|', 'simple']};
    if (!selected_file || !dialect_map.hasOwnProperty(dialect_name)) {
        // TODO Show error
        return;
    }
    let [delim, policy] = dialect_map[dialect_name];
    var reader = new FileReader();
    reader.onload = function(e) {
        let table_text = reader.result; 
        do_load_table(table_text, delim, policy);
        close_custom_table_dialog();
    }
    reader.readAsText(selected_file);
}


function after_load() {
    if (rbql === null || rbql_utils === null || template_js_text === null || !table_loaded)
        return;

    document.getElementById("rbql_run_btn").addEventListener("click", start_rbql);
    document.getElementById("ack_error").addEventListener("click", hide_error_msg);
    document.getElementById("open_custom_table_dialog").addEventListener("click", open_custom_table_dialog);
    document.getElementById("save_result_table").addEventListener("click", save_result_table);
    document.getElementById("tableSubmit").addEventListener("click", process_submit);
    document.getElementById("cancelSubmit").addEventListener("click", close_custom_table_dialog);
    //document.getElementById("rbql_input").focus();
    document.getElementById("rbql_input").addEventListener("keyup", function(event) {
        event.preventDefault();
        if (event.keyCode == 13) {
            start_rbql();
        }
    });
}


function main() {
    load_module('rbql_utils', 'rbql_utils.js', after_load);
    load_module('rbql', 'rbql.js', after_load);
    load_worker_template(after_load);
    load_default_table(after_load);
}

document.addEventListener("DOMContentLoaded", function(event) {
    main();
});
