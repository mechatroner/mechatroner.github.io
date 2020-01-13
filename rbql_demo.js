const max_display_records = 1000;

var table_chain = [];

// FIXME fix save_result_table method

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


// TODO switch to npm and soure web_rbql.js and csv_utils.js from node_modules in index.html


function strip_cr(line) {
    if (line.charAt(line.length - 1) === '\r') {
        return line.substring(0, line.length - 1);
    }
    return line;
}


function append_data_cell(row, cell_text, is_first) {
    let cell = document.createElement('td');
    cell.style.borderRight = '1px solid black';
    cell.style.borderTop = '1px solid black';
    if (is_first) {
        cell.style.backgroundColor = '#E5E5E5';
    }
    cell.textContent = cell_text;
    row.appendChild(cell);
}


function append_header_cell(row, cell_text) {
    let cell = document.createElement('th');
    cell.style.borderRight = '1px solid black';
    cell.textContent = cell_text;
    row.appendChild(cell);
}


function clean_table_chain(from_index) {
    while (table_chain.length > from_index) {
        let last_table = table_chain.pop();
        let root_node = last_table.root_node;
        root_node.remove();
    }
}


function create_save_click_handler(chain_index) {
    return function() { save_result_table(chain_index); };
}


function remove_children(root_node) {
    while (root_node.firstChild) {
        root_node.removeChild(root_node.firstChild);
    }
}


function populate_table(table, records, header_record) {
    let header_section = document.createElement('thead');
    let row = document.createElement('tr');
    append_header_cell(row, 'NR');
    for (let i = 0; i < records[0].length; i++) {
        let column_name = `a${i + 1}`;
        if (header_record && i < header_record.length) {
            column_name += '\r\n' + header_record[i];
        }
        append_header_cell(row, column_name);
    }
    header_section.appendChild(row);
    table.appendChild(header_section);
    let data_section = document.createElement('tbody');
    for (var nr = 0; nr < records.length && nr < max_display_records; nr++) {
        let row = document.createElement('tr');
        data_section.appendChild(row);
        append_data_cell(row, nr + 1, true);
        for (var nf = 0; nf < records[nr].length; nf++) {
            append_data_cell(row, records[nr][nf], false);
        }
    }
    table.appendChild(data_section);
}


function make_run_button_group(chain_index) {
    let proto_group = document.getElementById('proto_query_group');
    let result = proto_group.cloneNode(true);
    result.setAttribute('style', 'display: block');
    result.id = `query_group_${chain_index}`;

    let checkbox_elem = result.getElementsByTagName("input")[0];
    checkbox_elem.addEventListener('click', function() {
        let skip_header_row = checkbox_elem.checked;
        let table_records = table_chain[chain_index].records;
        let header_row = table_chain[chain_index].header;
        if (skip_header_row && !header_row && table_records.length) {
            table_chain[chain_index].header = table_records.splice(0, 1)[0];
        }
        if (!skip_header_row && header_row) {
            table_records.splice(0, 0, header_row);
            table_chain[chain_index].header = null;
        }

        let table = table_chain[chain_index].root_node.getElementsByTagName("table")[0];
        remove_children(table);
        populate_table(table, table_records, table_chain[chain_index].header);
    });
    let input_elem = result.getElementsByTagName('input')[1];
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


function make_next_chained_table_group(records) {
    // http://jsfiddle.net/mmavko/2ysb0hmf/   - sticky trick example
    let table_group = document.createElement('div');
    if (records.length == 0) {
        let empty_table_msg = document.createElement('span');
        empty_table_msg.textContent = 'Result table is empty';
        table_group.appendChild(empty_table_msg);
        table_chain.push({records: [], root_node: table_group, header: null});
        document.getElementById('table_chain_holder').appendChild(table_group);
        return;
    }
    let table_window = document.createElement('div');
    table_window.setAttribute('class', 'table_window');

    let table = document.createElement('table');

    populate_table(table, records, null);

    let warning_div = null;
    if (records.length > max_display_records) {
        warning_div = document.createElement('div');
        warning_div.setAttribute('class', 'table_cut_warning');
        warning_div.textContent = `Warning. Table is too big: showing only top ${max_display_records} entries, but the next RBQL query will be applied to the whole table (${records.length} records)`;
    }

    let save_button = null;
    if (table_chain.length) {
        save_button = document.createElement('button');
        save_button.setAttribute('class', 'dark_button');
        save_button.textContent = 'Save result table to disk';
        save_button.addEventListener("click", create_save_click_handler(table_chain.length));
    }
    table_window.appendChild(table);

    if (save_button)
        table_group.appendChild(save_button);
    if (warning_div)
        table_group.appendChild(warning_div);
    table_group.appendChild(table_window);
    table_group.appendChild(make_run_button_group(table_chain.length));
    table_chain.push({records: records, root_node: table_group, header: null});
    document.getElementById('table_chain_holder').appendChild(table_group);
}


function do_load_table(file_text, delim, policy) {
    clean_table_chain(0);
    var lines = file_text.split('\n');
    var records = [];
    var warning_line = null;
    for (var r = 0; r < lines.length; ++r) {
        let line = lines[r];
        line = strip_cr(line);
        if (r + 1 == lines.length && line.length == 0)
            break;
        var report = csv_utils.smart_split(line, delim, policy);
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
    make_next_chained_table_group(records);
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


function exception_to_error_info(e) {
    let exceptions_type_map = {
        'RbqlRuntimeError': 'query execution',
        'RbqlParsingError': 'query parsing',
        'RbqlIOHandlingError': 'IO handling'
    };
    let error_type = 'unexpected';
    if (e.constructor && e.constructor.name && exceptions_type_map.hasOwnProperty(e.constructor.name)) {
        error_type = exceptions_type_map[e.constructor.name];
    }
    let error_msg = e.hasOwnProperty('message') ? e.message : String(e);
    return [error_type, error_msg];
}


function start_rbql(src_chain_index) {
    console.log('starting rbql for chain index: ' + src_chain_index);
    if ("ga" in window) {
        // See: https://stackoverflow.com/a/40761709/2898283
        let tracker = ga.getAll()[0];
        if (tracker)
            tracker.send('event', 'Button', 'click', 'rbql_chain_run_' + src_chain_index);
    }
    clean_table_chain(src_chain_index + 1);
    var user_query = document.getElementById(`query_input_${src_chain_index}`).value;
    if (!user_query)
        return;
    let output_table = [];
    let warnings = [];
    let input_table = table_chain[src_chain_index].records;
    let input_column_names = table_chain[src_chain_index].header;
    if (!input_column_names && input_table.length)
        input_column_names = input_table[0];

    let error_handler = function(exception) {
        let [error_type, error_msg] = exception_to_error_info(exception);
        show_error(error_type, error_msg);
    }

    let success_handler = function() {
        console.log('warnings: ' + JSON.stringify(warnings));
        if (warnings.length) {
            show_warnings('RBQL Query has finished with Warnings', warnings);
        }
        make_next_chained_table_group(output_table);
    }
    let user_init_code = document.getElementById('udf_text_area').textContent;
    rbql.query_table(user_query, input_table, output_table, warnings, null, input_column_names, null, true, user_init_code).then(success_handler).catch(error_handler);
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
    // FIXME this won't work!
    let data_lines = table_chain[chain_index]['data_lines'];
    let file_content = data_lines.join('\r\n')
    let blob = new Blob([file_content], {type: "text/plain;charset=utf-8"});
    saveAs(blob, "rbql_output.txt");
}


function open_udf_dialog() {
    document.getElementById('udf_holder').style.display = 'block';
    document.getElementById('udf_text_area').textContent = '// Define some JS functions here and you will be able to use them in your query. Example: \nfunction foobar(value) {\n    return "foo" + value + "bar";\n}'
    document.getElementById('udf_text_area').focus();
}


function open_custom_table_dialog() {
    document.getElementById('table_load_dialog').style.display = 'block';
}


function close_custom_table_dialog() {
    document.getElementById('table_load_dialog').style.display = 'none';
}


function process_submit() {
    if ("ga" in window) {
        let tracker = ga.getAll()[0];
        if (tracker)
            tracker.send('event', 'Button', 'click', 'submit');
    }
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


function toggle_expandable_block(button_id, block_id) {
    let block = document.getElementById(block_id);
    if (block.style.display == 'none') {
        document.getElementById(button_id).style.backgroundColor = '#CC8B00';
        block.style.display = 'block';
    } else {
        document.getElementById(button_id).style.backgroundColor = '#FFE2CC';
        block.style.display = 'none';
    }
}


function after_load() {
    document.getElementById("ack_error").addEventListener("click", hide_error_msg);
    document.getElementById("open_custom_table_dialog").addEventListener("click", open_custom_table_dialog);
    document.getElementById("open_udf_dialog").addEventListener("click", open_udf_dialog);
    document.getElementById("tableSubmit").addEventListener("click", process_submit);
    document.getElementById("cancelSubmit").addEventListener("click", close_custom_table_dialog);
    document.getElementById("show_examples_button").addEventListener("click", () => { toggle_expandable_block('show_examples_button', 'examples_block'); });
    document.getElementById("show_explanation_button").addEventListener("click", () => { toggle_expandable_block('show_explanation_button', 'explanation_block'); });
}


function main() {
    load_module('csv_utils', 'csv_utils.js', () => {
        load_default_table(after_load);
    });
}


document.addEventListener("DOMContentLoaded", function(event) {
    main();
});
