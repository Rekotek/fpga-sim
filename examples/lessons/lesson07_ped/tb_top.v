// Тестбенч урока 7: перекрёсток с пешеходным переходом.
// Сценарий: круг без заявки; S1 на зелёном у A; круг без заявки; S1 поздно —
// уже во время фазы B_GO (заявка переносится на следующий круг).
// На каждом такте три правила безопасности: у дорог хотя бы один красный,
// пешеходный зелёный горит, только когда у дороги A горит один красный (не красный + жёлтый),
// пешеходные лампы не совпадают.
`timescale 1ns / 100ps

module tb_top;
    localparam integer BOUNCE = 3;
    localparam [3:0] S_A_GO = 4'd0, S_B_GO = 4'd5, S_B_BLINK = 4'd6;

    reg        clk = 1'b0;
    reg  [1:0] btn = 2'b00;           // btn[0] = S1, btn[1] = S2
    wire [5:0] led;
    wire       ped_r, ped_g;

    always #18.5 clk = ~clk;

    // CLK_HZ = 1000: «секунда» = 1000 тактов, антидребезг раз в 10 тактов.
    top #(.CLK_HZ(1000)) dut (.clk(clk), .btn_s1(btn[0]), .btn_s2(btn[1]),
                              .led(led), .ped_r(ped_r), .ped_g(ped_g));

    wire [2:0] a = ~led[2:0];         // дорога A: {зелёный, жёлтый, красный}
    wire [2:0] b = ~led[5:3];         // дорога B
    integer    errors = 0, danger = 0;

    // Правила безопасности — на каждом такте.
    always @(negedge clk) begin
        if (!a[0] && !b[0])       danger = danger + 1;   // обе дороги без красного
        if (ped_g && a != 3'b001) danger = danger + 1;   // пешеходы идут, а у A не только красный
        if (ped_g == ped_r)       danger = danger + 1;   // пешеходные лампы обе или ни одной
    end

    // Кнопка с дребезгом (урок 6).
    task move (input integer i, input v);
        integer k;
        begin
            for (k = 0; k < BOUNCE; k = k + 1) begin
                btn[i] = v;   #60;
                btn[i] = ~v;  #40;
            end
            btn[i] = v;  #1500;
        end
    endtask

    // Дождаться состояния s, подождать внутри него 500 тактов и сверить пешеходный зелёный.
    task at (input [3:0] s, input want_g);
        begin
            wait (dut.state == s);
            repeat (500) @(negedge clk);
            $display("   %0d     %b      %b       %b", dut.state, ped_r, ped_g, want_g);
            if (ped_g !== want_g) errors = errors + 1;
        end
    endtask

    initial begin
        $dumpfile("tb_top.vcd");
        $dumpvars(0, tb_top);
        $display("state  ped_r  ped_g  ожидали ped_g");

        at(S_B_GO, 1'b0);                         // круг 1: заявки нет — пешеходам красный
        wait (dut.state == S_A_GO);
        move(0, 1'b1);  move(0, 1'b0);            // S1 на зелёном у A
        $display("S1 нажали, заявка ped_req = %b", dut.ped_req);
        at(S_B_GO,    1'b1);                      // круг 2: пешеходам зелёный
        at(S_B_BLINK, 1'b0);                      // B мигает — пешеходам уже красный
        at(S_B_GO,    1'b0);                      // круг 3: заявки нет
        move(0, 1'b1);  move(0, 1'b0);            // S1 поздно: B_GO уже идёт
        $display("S1 нажали во время B_GO, ped_req = %b", dut.ped_req);
        at(S_B_BLINK, 1'b0);                      // в этой фазе зелёного так и нет
        at(S_B_GO,    1'b1);                      // круг 4: заявка обслужена

        $display("опасных тактов: %0d", danger);
        if (errors == 0 && danger == 0) $display("ТЕСТ ПРОЙДЕН");
        else $display("ТЕСТ НЕ ПРОЙДЕН: ошибок %0d, опасных тактов %0d", errors, danger);
        $finish;
    end
endmodule
