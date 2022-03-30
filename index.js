const max_display_records = 1000;

var table_chain = [];

var last_delim = null;
var last_policy = null;

var last_join_upload_chain_index = null;

// TODO support rfc-csv dialect


function make_element(tag_name, parent_element=null, class_name=null, text_content=null, element_id=null) {
    let result = document.createElement(tag_name);
    if (class_name)
        result.setAttribute('class', class_name);
    if (text_content)
        result.textContent = text_content;
    if (parent_element)
        parent_element.appendChild(result);
    if (element_id !== null)
        result.id = element_id;
    return result;
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


// TODO switch to npm and soure rbql.js and csv_utils.js from node_modules in index.html


function strip_cr(line) {
    if (line.charAt(line.length - 1) === '\r') {
        return line.substring(0, line.length - 1);
    }
    return line;
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


function populate_table(table, records, header_record, column_name_prefix='a') {
    let header_section = make_element('thead', table);
    let row = make_element('tr', header_section);
    make_element('th', row, null, 'NR');
    for (let i = 0; i < records[0].length; i++) {
        let column_name = column_name_prefix + String(i + 1);
        if (header_record && i < header_record.length) {
            column_name += '\r\n' + header_record[i];
        }
        make_element('th', row, null, column_name);
    }
    let data_section = make_element('tbody', table);
    for (var nr = 0; nr < records.length && nr < max_display_records; nr++) {
        let row = make_element('tr', data_section);
        make_element('td', row, 'nr_cell', nr + 1);
        for (var nf = 0; nf < records[nr].length; nf++) {
            make_element('td', row, null, records[nr][nf]);
        }
    }
}


function send_tracking_info(element_type, event_type, tag) {
    try {
        if ("ga" in window) {
            // See: https://stackoverflow.com/a/40761709/2898283
            let tracker = ga.getAll()[0];
            if (tracker)
                tracker.send('event', element_type, event_type, tag);
        }
    } catch (e) {
        console.error('Unable to send tracking info: ' + String(e));
    }
}


function adjust_records_and_header(skip_header_row, table_obj) {
    let table_records = table_obj.records;
    let header_row = table_obj.header;
    if (skip_header_row && !header_row && table_records.length) {
        table_obj.header = table_records.splice(0, 1)[0];
    }
    if (!skip_header_row && header_row) {
        table_records.splice(0, 0, header_row);
        table_obj.header = null;
    }
}


function make_run_button_group(chain_index) {
    let proto_group = document.getElementById('proto_query_group');
    let result = proto_group.cloneNode(true);
    result.setAttribute('style', 'display: block');
    result.id = `query_group_${chain_index}`;

    let checkbox_elem = result.getElementsByTagName("input")[0];
    checkbox_elem.addEventListener('click', function() {
        send_tracking_info('Checkbox', 'click', 'skip_header_' + checkbox_elem.checked);
        let skip_header_row = checkbox_elem.checked;
        adjust_records_and_header(skip_header_row, table_chain[chain_index].input);

        let table = document.getElementById(`a_table_${chain_index}`);
        remove_children(table);
        populate_table(table, table_chain[chain_index].input.records, table_chain[chain_index].input.header, 'a');
        if (table_chain[chain_index].join.records !== null) {
            adjust_records_and_header(skip_header_row, table_chain[chain_index].join);
            let join_table = document.getElementById(`b_table_${chain_index}`);
            remove_children(join_table);
            populate_table(join_table, table_chain[chain_index].join.records, table_chain[chain_index].join.header, 'b');
        }
    });
    let input_elem = result.getElementsByTagName('input')[1];
    input_elem.id = `query_input_${chain_index}`;

    let fetch_join_header_callback = function(join_table_id, adjust_join_table_headers) {
        let join_header = null;
        if (join_table_id.toLowerCase() == 'b') {
            join_header = table_chain[chain_index].join.header;
        }
        adjust_join_table_headers(join_header);
    }

    if (chain_index == 0) { // FIXME make suggest context a class/object which can be initialized for each table separately, to get rid of this hack
        rbql_suggest.initialize_suggest(input_elem.id, 'query_suggest', 'suggest_button', null, table_chain[chain_index].input.header, fetch_join_header_callback);
    }

    input_elem.addEventListener("keyup", function(event) {
        rbql_suggest.handle_input_keyup(event);
    });

    input_elem.addEventListener("keydown", function(event) {
        if (event.keyCode == 13 && rbql_suggest.active_suggest_idx === null) {
            start_rbql(chain_index);
        } else {
            rbql_suggest.handle_input_keydown(event);
        }
    });

    let button_elem = result.getElementsByTagName('button')[0];
    button_elem.addEventListener('click', function() { start_rbql(chain_index); });

    return result;
}


function make_table(table_window, records, header, chain_index, column_name_prefix) {
    let table_id = `${column_name_prefix}_table_${chain_index}`;
    let table = make_element('table', table_window, null, null, table_id);
    populate_table(table, records, header, column_name_prefix);
    if (records.length > max_display_records)
        make_element('div', table_window, 'table_cut_warning', `Warning. Table is too big: showing only top ${max_display_records} entries, but the next RBQL query will be applied to the whole table (${records.length} records)`);
}


function make_next_chained_table_group(records, header) {
    if (!header || !header.length)
        header = null;
    // http://jsfiddle.net/mmavko/2ysb0hmf/   - sticky trick example
    let table_group = make_element('div', document.getElementById('table_chain_holder'));
    if (records.length == 0) {
        make_element('span', table_group, null, 'Result table is empty');
        table_chain.push({root_node: table_group, input: {records: [], header: header}, join: {records: null, header: null}});
        return;
    }
    let chain_index = table_chain.length;
    let table_row = make_element('div', table_group, 'flex_row standard_margin_top');
    let table_window = make_element('div', table_row, 'table_window', null, `input_window_${chain_index}`);
    let join_window = make_element('div', table_row, null, null, `join_window_${chain_index}`);
    let add_join_button = make_element('button', join_window, 'dark_button tall_button', 'Add\r\njoin\r\ntable\r\n"b"\r\n>>>\r\n');
    (function(join_upload_chain_index) {
        add_join_button.addEventListener("click", () => {
            last_join_upload_chain_index = join_upload_chain_index;
            document.getElementById('default_join_info').style.display = 'block';
            document.getElementById('table_load_dialog').style.display = 'block';
        }); 
    })(chain_index);

    make_table(table_window, records, header, chain_index, 'a');

    if (chain_index) {
        let save_button = make_element('button', table_group, 'dark_button', 'Save result table to disk');
        save_button.addEventListener("click", create_save_click_handler(chain_index));
    }

    table_chain.push({root_node: table_group, input: {records: records, header: header}, join: {records: null, header: null}});
    table_group.appendChild(make_run_button_group(chain_index));
}


function add_join_table_to_chain_group(records, header, chain_index) {
    let join_window = document.getElementById(`join_window_${chain_index}`);
    join_window.getElementsByTagName("button")[0].remove();
    join_window.setAttribute('class', 'table_window');
    make_table(join_window, records, header, chain_index, 'b');
    table_chain[chain_index].join.records = records;
    table_chain[chain_index].join.header = header;
}


function do_load_table(file_text, delim, policy) {
    var lines = file_text.split('\n');
    var records = [];
    var warning_line = null;
    // TODO use standard trick with counting double quoted to support rfc
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
    let header = null;
    if (records && records.length) {
        header = records.splice(0, 1)[0];
    }
    if (warning_line != null) {
        show_warnings('Input file has quoting issues', ['Double quotes usage is not consistent at some lines. E.g. at line ' + warning_line]);
    }
    if (last_join_upload_chain_index === null) {
        clean_table_chain(0);
        make_next_chained_table_group(records, header);
    } else {
        clean_table_chain(last_join_upload_chain_index + 1);
        add_join_table_to_chain_group(records, header, last_join_upload_chain_index);
    }
}


function load_default_tsv_table(local_url, callback_func) {
    var xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function () {
        if (xhr.readyState == XMLHttpRequest.DONE) {
            last_delim = '\t';
            last_policy = 'simple';
            do_load_table(xhr.responseText, last_delim, last_policy);
            if (callback_func)
                callback_func();
        }
    }
    xhr.open('GET', local_url, true);
    xhr.send(null);
}


function start_rbql(src_chain_index) {
    console.log('starting rbql for chain index: ' + src_chain_index);
    send_tracking_info('Button', 'click', 'rbql_chain_run_' + src_chain_index);
    clean_table_chain(src_chain_index + 1);
    var user_query = document.getElementById(`query_input_${src_chain_index}`).value;
    if (!user_query)
        return;
    let output_table = [];
    let output_column_names = [];
    let warnings = [];

    let error_handler = function(exception) {
        let [error_type, error_msg] = rbql.exception_to_error_info(exception);
        show_error(error_type, error_msg);
    }

    let success_handler = function() {
        console.log('warnings: ' + JSON.stringify(warnings));
        if (warnings.length) {
            show_warnings('RBQL Query has finished with Warnings', warnings);
        }
        make_next_chained_table_group(output_table, output_column_names);
    }
    let user_init_code = document.getElementById('udf_text_area').textContent;

    let input_table = table_chain[src_chain_index].input.records;
    let input_column_names = table_chain[src_chain_index].input.header;
    let join_table = table_chain[src_chain_index].join.records;
    let join_column_names = join_table === null ? null : table_chain[src_chain_index].join.header;
    rbql.query_table(user_query, input_table, output_table, warnings, join_table, input_column_names, join_column_names, output_column_names, true, user_init_code).then(success_handler).catch(error_handler);
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


function smart_join(fields, delim, policy) {
    if (policy == 'simple')
        return fields.join(delim);
    if (policy == 'quoted')
        return fields.map(v => csv_utils.quote_field(String(v), delim));
    if (policy == 'quoted_rfc')
        return fields.map(v => csv_utils.rfc_quote_field(String(v), delim));
    throw new Error('Unknown policy: ' + policy);
}


function save_result_table(chain_index) {
    let table_records = table_chain[chain_index].input.records;
    let header_row = table_chain[chain_index].input.header;
    if (header_row)
        table_records = [header_row].concat(table_records);
    let data_lines = table_records.map(r => smart_join(r, last_delim, last_policy));
    let file_content = data_lines.join('\r\n')
    let blob = new Blob([file_content], {type: "text/plain;charset=utf-8"});
    saveAs(blob, "rbql_output.txt");
}


function open_udf_dialog() {
    send_tracking_info('Button', 'click', 'edit_udf');
    document.getElementById('udf_holder').style.display = 'block';
    document.getElementById('udf_text_area').textContent = '// Define some JS functions here and you will be able to use them in your query. Example: \nfunction foobar(value) {\n    return "foo" + value + "bar";\n}'
    document.getElementById('udf_text_area').focus();
}


function open_custom_table_dialog() {
    last_join_upload_chain_index = null;
    document.getElementById('default_join_info').style.display = 'none';
    document.getElementById('table_load_dialog').style.display = 'block';
}


function close_custom_table_dialog() {
    document.getElementById('table_load_dialog').style.display = 'none';
}


function process_upload_default_join_table() {
    load_default_tsv_table('countries.tsv', null);
    close_custom_table_dialog();
}


function process_submit() {
    send_tracking_info('Button', 'click', 'submit');
    var inputElem = document.getElementById("doLoadTable");
    var selected_file = inputElem.files[0];
    let drop_down_list = document.getElementById("separator_ddl");
    let dialect_name = drop_down_list.options[drop_down_list.selectedIndex].value;
    let dialect_map = {'csv': [',', 'quoted'], 'tsv': ['\t', 'simple'], 'csv (semicolon)': [';', 'quoted'], 'csv (pipe)': ['|', 'simple']};
    if (!selected_file || !dialect_map.hasOwnProperty(dialect_name)) {
        return;
    }
    [last_delim, last_policy] = dialect_map[dialect_name];
    var reader = new FileReader();
    reader.onload = function(e) {
        let table_text = reader.result; 
        do_load_table(table_text, last_delim, last_policy);
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
    document.getElementById("upload_default_join").addEventListener("click", process_upload_default_join_table);
}


function main() {
    load_module('csv_utils', 'csv_utils.js', () => {
        load_default_tsv_table('movies.tsv', after_load);
    });
}


document.addEventListener("DOMContentLoaded", function(event) {
    main();
});
