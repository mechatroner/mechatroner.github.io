// Constants:

var rbql_utils = null;
var rbql = null;
var rbql_worker = null;

var template_js_text = null;

var __dirname = 'fake_rbql_home_dir';

// State:

var table_chain = [];

var last_web_writer = null;
var last_web_reader = null;

var global_delim = null; // delim in policy are constants in chain
var global_policy = null;

let last_output_lines = null;

// Functions:

// FIXME make examples hidden by default - user can fold / unfold them


function WebEmulationError(message) {
   this.message = message;
   this.name = 'WebEmulationError';
}


function AssertionError(message) {
   this.message = message;
   this.name = 'AssertionError';
}


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
        last_output_lines.push(line);
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
        if (!this.closed) {
            this.closed = true;
            this.close_callback();
        }
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
    // Emulation of Node.js require() function
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


function append_cell(row, cell_text, params) {
    let cell = document.createElement('td');
    if (params['use_special_border']) {
        cell.style.border = '1px solid red';
    } else {
        cell.style.border = '1px solid #4A5646';
    }
    if (params['use_special_color']) {
        cell.style.color = '#FF6868';
    }
    cell.textContent = cell_text;
    row.appendChild(cell);
}


function clean_table_chain(from_index) {
    while (table_chain.length > from_index) {
        let last_table = table_chain.pop();
        let root_node = last_table['root_node'];
        root_node.remove();
    }
}


function create_save_click_handler(chain_index) {
    return function() { save_result_table(chain_index); };
}


function make_run_button_group(chain_index) {
    let proto_group = document.getElementById('proto_query_group');
    let result = proto_group.cloneNode(true);
    result.setAttribute('style', 'display: block');
    result.id = `query_group_${chain_index}`;

    let input_elem = result.getElementsByTagName('input')[0];
    input_elem.id = `query_input_${chain_index}`;
    input_elem.addEventListener("keyup", function(event) {
        event.preventDefault();
        if (event.keyCode == 13) {
            start_rbql(chain_index);
        }
    });

    let button_elem = result.getElementsByTagName('button')[0];
    button_elem.addEventListener('click', function() { start_rbql(chain_index); });

    return result;
}


function make_next_chained_table(records, data_lines) {
    let table_group = document.createElement('div');
    if (records.length == 0) {
        let empty_table_msg = document.createElement('span');
        empty_table_msg.textContent = 'Result table is empty';
        table_group.appendChild(empty_table_msg);
        table_chain.push({'data_lines': [], 'root_node': table_group});
        document.getElementById('table_chain_holder').appendChild(table_group);
        return;
    }
    let table_window = document.createElement('div');
    table_window.setAttribute('class', 'table_window');
    let table = document.createElement('table');
    let warning_div = null;
    if (records.length > 1000) {
        records = records.slice(0, 1000);
        let warning_div = document.createElement('div');
        warning_div.setAttribute('class', 'table_cut_warning');
        warning_div.textContent = 'Warning. Table is too big: showing only top 1000 entries, but RBQL query will be applied to the whole original table';
    }
    let row = document.createElement('tr');
    table.appendChild(row);
    append_cell(row, 'NR', {'use_special_border': true, 'use_special_color': true});
    for (let i = 0; i < records[0].length; i++) {
        append_cell(row, `a${i + 1}`, {'use_special_border': true, 'use_special_color': true});
    }
    for (var nr = 0; nr < records.length; nr++) {
        let row = document.createElement('tr');
        table.appendChild(row);
        append_cell(row, nr + 1, {'use_special_border': true, 'use_special_color': false});
        for (var nf = 0; nf < records[nr].length; nf++) {
            append_cell(row, records[nr][nf], {'use_special_border': false, 'use_special_color': false});
        }
    }
    let save_button = null;
    if (table_chain.length) {
        save_button = document.createElement('button');
        save_button.setAttribute('class', 'dark_button');
        save_button.textContent = 'Save result table to disk';
        save_button.addEventListener("click", create_save_click_handler(table_chain.length));
    }
    table_window.appendChild(table);

    if (warning_div)
        table_group.appendChild(warning_div);
    if (save_button)
        table_group.appendChild(save_button);
    table_group.appendChild(table_window);
    table_group.appendChild(make_run_button_group(table_chain.length));
    table_chain.push({'data_lines': data_lines, 'root_node': table_group});
    document.getElementById('table_chain_holder').appendChild(table_group);
}


function strip_cr(line) {
    if (line.charAt(line.length - 1) === '\r') {
        return line.substring(0, line.length - 1);
    }
    return line;
}


function do_load_table(file_text, delim, policy) {
    global_delim = delim;
    global_policy = policy;
    clean_table_chain(0);
    var lines = file_text.split('\n');
    var records = [];
    let loaded_lines = [];
    var warning_line = null;
    for (var r = 0; r < lines.length; ++r) {
        let line = lines[r];
        line = strip_cr(line);
        if (r + 1 == lines.length && line.length == 0)
            break;
        loaded_lines.push(line);
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
    make_next_chained_table(records, loaded_lines);
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
    var records = [];
    for (var i = 0; i < last_output_lines.length; i++) {
        records.push(smart_split(last_output_lines[i], global_delim, global_policy)[0]);
    }
    make_next_chained_table(records, last_output_lines);
}


function handle_rbql_worker_error(error_msg) {
    show_error('RBQL Backend', error_msg);
}


function get_error_message(error) {
    if (error && error.message)
        return error.message;
    return String(error);
}


function start_rbql(src_chain_index) {
    console.log('starting rbql for chain index: ' + src_chain_index);
    clean_table_chain(src_chain_index + 1);
    var rbql_text = document.getElementById(`query_input_${src_chain_index}`).value;
    if (!rbql_text)
        return;
    last_output_lines = [];
    last_web_writer = new WebWriter();
    last_web_reader = new WebReader();
    let worker_text = null;
    try {
        worker_text = rbql.parse_to_js_almost_web('fake_src_path', 'fake_dst_path', [rbql_text], template_js_text, global_delim, global_policy, global_delim, global_policy, 'binary');
        load_module_from_string('rbql_worker', worker_text);
    } catch (e) {
        show_error('RBQL parsing', get_error_message(e));
        return;
    }
    rbql_worker.run_on_node(handle_rbql_worker_success, handle_rbql_worker_error);
    let input_lines = table_chain[src_chain_index]['data_lines'];
    for (let i = 0; i < input_lines.length; i++) {
        let line = input_lines[i];
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


function save_result_table(chain_index) {
    let data_lines = table_chain[chain_index]['data_lines'];
    let file_content = data_lines.join('\r\n')
    let blob = new Blob([file_content], {type: "text/plain;charset=utf-8"});
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
    if (rbql === null || rbql_utils === null || template_js_text === null || !table_chain.length)
        return;

    document.getElementById("ack_error").addEventListener("click", hide_error_msg);
    document.getElementById("open_custom_table_dialog").addEventListener("click", open_custom_table_dialog);
    document.getElementById("tableSubmit").addEventListener("click", process_submit);
    document.getElementById("cancelSubmit").addEventListener("click", close_custom_table_dialog);
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
